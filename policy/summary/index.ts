import * as pulumi from "@pulumi/pulumi";
import * as fs from "fs";
import * as path from "path";
import { PolicyPack, ReportViolation, StackValidationArgs } from "@pulumi/policy";
import { AWSConfig, TemporalConfig, BenchmarkConfig, PersistenceConfig } from "../../infra/cluster/types";

// Report directory
const REPORT_DIRECTORY = "../../reports";


// Resource information interface for reporting
interface ResourceInfo {
    region?: string;
    availabilityZones?: string[];
    eksCluster?: {
        name: string;
    };
    nodeGroups: Array<{
        name: string;
        instanceType: string;
        nodeCount: number;
        purpose?: 'core' | 'temporal' | 'worker' | 'cassandra';
    }>;
    cassandraNodeGroups: Array<{
        name: string;
        instanceType: string;
        nodeCount: number;
        cpuRequest?: number;
        memoryRequest?: string;
        commitLogStorageGB?: number;
        dataStorageGB?: number;
    }>;
    rdsInstances: Array<{
        name: string;
        instanceClass: string;
        storageGB: number;
        storageType?: string;
        engine?: string;
        engineVersion?: string;
        multiAz?: boolean;
    }>;
    openSearchInstances: Array<{
        name: string;
        masterInstanceType?: string;
        masterInstanceCount?: number;
        dataInstanceType?: string;
        dataInstanceCount?: number;
        // Legacy fields for backward compatibility
        instanceType?: string;
        instanceCount?: number;
        engineVersion?: string;
    }>;
    temporalServices?: {
        frontend?: {
            pods: number;
            cpuPerPod: number;
            memoryPerPod: string;
        };
        history?: {
            pods: number;
            cpuPerPod: number;
            memoryPerPod: string;
            shards?: number;
        };
        matching?: {
            pods: number;
            cpuPerPod: number;
            memoryPerPod: string;
        };
        worker?: {
            pods: number;
            cpuPerPod: number;
            memoryPerPod: string;
        };
    };
    benchmarkWorkers?: {
        namespaces: number;
        target: number;
        workers?: {
            pods: number;
            cpuRequest: number | string;
            memoryRequest: string;
            workflowPollers: number;
            activityPollers: number;
        };
        soakTest?: {
            pods: number;
            cpuRequest: number | string;
            memoryRequest: string;
        };
    };
}

/**
 * Summary policies to discover and report AWS infrastructure resources
 */
new PolicyPack("summary", {
    policies: [
        {
            name: "stack-resources-summary-report",
            description: "Analyzes all resources in the stack to generate a comprehensive resource summary report",
            enforcementLevel: "advisory",
            validateStack: async (args: StackValidationArgs, reportViolation: ReportViolation) => {
                const stackName = pulumi.getStack();

                // Access configuration directly using Pulumi Config API
                const config = new pulumi.Config();
                const awsConfig = config.getObject<AWSConfig>('AWS');
                const temporalConfig = config.getObject<TemporalConfig>('Temporal');
                const benchmarkConfig = config.getObject<BenchmarkConfig>('Benchmark');
                const persistenceConfig = config.getObject<PersistenceConfig>('Persistence');
                
                // Get region for resource discovery
                const region = awsConfig?.Region || 'us-east-1';
                
                // Initialize resource info collection
                const resourceInfo: ResourceInfo = {
                    nodeGroups: [],
                    cassandraNodeGroups: [],
                    rdsInstances: [],
                    openSearchInstances: []
                };

                // Set region and availability zones from config
                if (awsConfig) {
                    resourceInfo.region = awsConfig.Region;
                    resourceInfo.availabilityZones = awsConfig.AvailabilityZones;
                }

                // Cache for launch template instance types
                const launchTemplateCache: Record<string, string> = {};

                // First pass - collect launch templates information
                for (const [urn, resource] of Object.entries(args.resources)) {
                    if (resource.type === "aws:ec2/launchTemplate:LaunchTemplate") {
                        const template = resource.props;
                        if (template.name && template.instanceType) {
                            launchTemplateCache[template.name] = template.instanceType;
                        }
                    }
                }

                // Second pass - process all resources
                for (const [urn, resource] of Object.entries(args.resources)) {
                    switch (resource.type) {
                        case "eks:index/cluster:Cluster":
                            resourceInfo.eksCluster = {
                                name: resource.name
                            };
                            break;
                            
                        case "aws:autoscaling/group:Group":
                            const asg = resource.props;
                            const nodeCount = asg.desiredCapacity || asg.maxSize || asg.minSize || 1;
                            
                            // Try to get the instance type from the launch template
                            let instanceType = 't3.medium'; // Default if we can't find it
                            
                            if (asg.launchTemplate && asg.launchTemplate.name && 
                                launchTemplateCache[asg.launchTemplate.name]) {
                                instanceType = launchTemplateCache[asg.launchTemplate.name];
                            }
                            
                            
                            // Determine the purpose of this node group
                            let purpose: 'core' | 'temporal' | 'worker' | 'cassandra' | undefined;
                            if (resource.name.includes('-cassandra')) {
                                purpose = 'cassandra';
                            } else if (resource.name.includes('-temporal')) {
                                purpose = 'temporal';
                            } else if (resource.name.includes('-worker')) {
                                purpose = 'worker';
                            } else if (resource.name.includes('-core')) {
                                purpose = 'core';
                            }
                            
                            // If this is a Cassandra node group, store it separately
                            if (purpose === 'cassandra') {
                                // Parse storage sizes
                                const commitLogStorageGB = parseStorageSize(persistenceConfig?.Cassandra?.CommitLogStorage || '0');
                                const dataStorageGB = parseStorageSize(persistenceConfig?.Cassandra?.DataStorage || '0');
                                
                                resourceInfo.cassandraNodeGroups.push({
                                    name: resource.name,
                                    instanceType,
                                    nodeCount,
                                    cpuRequest: persistenceConfig?.Cassandra?.CPU?.Limit,
                                    memoryRequest: persistenceConfig?.Cassandra?.Memory?.Limit,
                                    commitLogStorageGB,
                                    dataStorageGB
                                });
                            } else {
                                // Store regular node groups (non-Cassandra)
                                resourceInfo.nodeGroups.push({
                                    name: resource.name,
                                    instanceType,
                                    nodeCount,
                                    purpose
                                });
                            }
                            break;
                            
                        case "aws:rds/instance:Instance":
                            const rdsInstance = resource.props;
                            const instanceClass = rdsInstance.instanceClass || "db.t3.medium";
                            const engine = rdsInstance.engine || persistenceConfig?.RDS?.Engine || "postgres";
                            
                            
                            resourceInfo.rdsInstances.push({
                                name: resource.name,
                                instanceClass,
                                storageGB: rdsInstance.allocatedStorage || 1024,
                                storageType: rdsInstance.storageType,
                                engine: rdsInstance.engine,
                                engineVersion: rdsInstance.engineVersion,
                                multiAz: rdsInstance.multiAz
                            });
                            break;
                            
                        case "aws:opensearch/domain:Domain":
                            const openSearchDomain = resource.props;
                            const clusterConfig = openSearchDomain.clusterConfig || {};
                            
                            // Check if dedicated master is enabled (new master/data split format)
                            if (clusterConfig.dedicatedMasterEnabled) {
                                // New format with master/data split
                                const masterInstanceType = clusterConfig.dedicatedMasterType || persistenceConfig?.Visibility?.OpenSearch?.MasterInstanceType || "m5.large.search";
                                const masterInstanceCount = clusterConfig.dedicatedMasterCount || persistenceConfig?.Visibility?.OpenSearch?.MasterInstanceCount || 3;
                                const dataInstanceType = clusterConfig.instanceType || persistenceConfig?.Visibility?.OpenSearch?.DataInstanceType || "r6gd.2xlarge.search";
                                const dataInstanceCount = clusterConfig.instanceCount || persistenceConfig?.Visibility?.OpenSearch?.DataInstanceCount || (awsConfig?.AvailabilityZones?.length || 3);
                                
                                
                                resourceInfo.openSearchInstances.push({
                                    name: resource.name,
                                    masterInstanceType,
                                    masterInstanceCount,
                                    dataInstanceType,
                                    dataInstanceCount,
                                    engineVersion: openSearchDomain.engineVersion
                                });
                            } else {
                                // Legacy format (single instance type) for backward compatibility
                                const osInstanceType = clusterConfig.instanceType || "m5.large.search";
                                const osInstanceCount = clusterConfig.instanceCount || (awsConfig?.AvailabilityZones?.length || 3);
                                
                                
                                resourceInfo.openSearchInstances.push({
                                    name: resource.name,
                                    instanceType: osInstanceType,
                                    instanceCount: osInstanceCount,
                                    engineVersion: openSearchDomain.engineVersion
                                });
                            }
                            break;
                    }
                }

                // Process Temporal services configuration
                if (temporalConfig) {
                    const parseCpu = (val: any) => typeof val === 'string' ? parseFloat(val) : val;
                    const parseMem = (val: any) => {
                        if (typeof val === 'number') return val;
                        if (!val) return 0;
                        if (val.endsWith('Gi')) return parseFloat(val) * 1024;
                        if (val.endsWith('Mi')) return parseFloat(val);
                        return parseFloat(val);
                    };
                    const formatMem = (mi: number) => mi >= 1024 ? `${(mi / 1024).toFixed(2)}Gi` : `${mi}Mi`;

                    resourceInfo.temporalServices = {};

                    if (temporalConfig.Frontend) {
                        const frontend = temporalConfig.Frontend;
                        const pods = frontend.Pods || 0;
                        const cpuPerPod = parseCpu(frontend.CPU?.Request || 0);
                        const memoryPerPod = parseMem(frontend.Memory?.Request || '0Mi');
                        resourceInfo.temporalServices.frontend = {
                            pods,
                            cpuPerPod,
                            memoryPerPod: formatMem(memoryPerPod)
                        };
                    }

                    if (temporalConfig.History) {
                        const history = temporalConfig.History;
                        const pods = history.Pods || 0;
                        const cpuPerPod = parseCpu(history.CPU?.Request || 0);
                        const memoryPerPod = parseMem(history.Memory?.Request || '0Mi');
                        resourceInfo.temporalServices.history = {
                            pods,
                            cpuPerPod,
                            memoryPerPod: formatMem(memoryPerPod),
                            shards: history.Shards
                        };
                    }

                    if (temporalConfig.Matching) {
                        const matching = temporalConfig.Matching;
                        const pods = matching.Pods || 0;
                        const cpuPerPod = parseCpu(matching.CPU?.Request || 0);
                        const memoryPerPod = parseMem(matching.Memory?.Request || '0Mi');
                        resourceInfo.temporalServices.matching = {
                            pods,
                            cpuPerPod,
                            memoryPerPod: formatMem(memoryPerPod)
                        };
                    }

                    if (temporalConfig.Worker) {
                        const worker = temporalConfig.Worker;
                        const pods = worker.Pods || 0;
                        const cpuPerPod = parseCpu(worker.CPU?.Request || 0);
                        const memoryPerPod = parseMem(worker.Memory?.Request || '0Mi');
                        resourceInfo.temporalServices.worker = {
                            pods,
                            cpuPerPod,
                            memoryPerPod: formatMem(memoryPerPod)
                        };
                    }
                }

                // Process Benchmark configuration
                if (benchmarkConfig) {
                    resourceInfo.benchmarkWorkers = {
                        namespaces: benchmarkConfig.Namespaces || 0,
                        target: benchmarkConfig.Target || 0
                    };

                    if (benchmarkConfig.Workers) {
                        const workers = benchmarkConfig.Workers;
                        resourceInfo.benchmarkWorkers.workers = {
                            pods: workers.Pods || 0,
                            cpuRequest: workers.CPU?.Request || '-',
                            memoryRequest: workers.Memory?.Request || '-',
                            workflowPollers: workers.WorkflowPollers || 0,
                            activityPollers: workers.ActivityPollers || 0
                        };
                    }

                    if (benchmarkConfig.SoakTest) {
                        const soakTest = benchmarkConfig.SoakTest;
                        resourceInfo.benchmarkWorkers.soakTest = {
                            pods: soakTest.Pods || 0,
                            cpuRequest: soakTest.CPU?.Request || '-',
                            memoryRequest: soakTest.Memory?.Request || '-',
                        };
                    }
                }

                // Update RDS engine/version from config if available
                if (persistenceConfig?.RDS && resourceInfo.rdsInstances.length > 0) {
                    resourceInfo.rdsInstances[0].engine = persistenceConfig.RDS.Engine || resourceInfo.rdsInstances[0].engine;
                    resourceInfo.rdsInstances[0].engineVersion = persistenceConfig.RDS.EngineVersion || resourceInfo.rdsInstances[0].engineVersion;
                }


                // Generate the markdown report
                const reportContent = generateMarkdownReport(stackName, resourceInfo);
                
                // Save the report to the configured directory
                try {
                    // Create the directory if it doesn't exist
                    if (!fs.existsSync(REPORT_DIRECTORY)) {
                        fs.mkdirSync(REPORT_DIRECTORY, { recursive: true });
                    }
                    
                    const reportPath = path.join(REPORT_DIRECTORY, `${stackName}.md`);
                    fs.writeFileSync(reportPath, reportContent);
                    
                    reportViolation(`Generated stack resource summary report for "${stackName}" at ${reportPath}.`);
                } catch (error) {
                    reportViolation(`Failed to save report: ${error}`);
                }
            },
        },
    ],
});

// Helper function to parse storage size strings (e.g., "1Gi", "1Ti", "100Mi") to GB
function parseStorageSize(sizeStr: string): number {
    if (!sizeStr || sizeStr === '0') return 0;
    
    const sizeMatch = sizeStr.match(/^(\d+(?:\.\d+)?)(Mi|Gi|Ti|GB|TB)?$/);
    if (!sizeMatch) {
        throw new Error(`Invalid storage size format: ${sizeStr}`);
    }
    
    const value = parseFloat(sizeMatch[1]);
    const unit = sizeMatch[2] || 'GB';
    
    switch (unit) {
        case 'Mi':
            return value / 1024; // MB to GB
        case 'Gi':
            return value; // Gi is approximately GB
        case 'Ti':
            return value * 1024; // Ti to GB
        case 'GB':
            return value;
        case 'TB':
            return value * 1024; // TB to GB
        default:
            throw new Error(`Unsupported storage unit: ${unit}`);
    }
}

// Helper function to get CPU cores for AWS instance types
function getInstanceTypeCpuCores(instanceType: string): number {
    // Common AWS instance type CPU core mappings
    const instanceCores: Record<string, number> = {
        // RDS instance types
        'db.t3.micro': 2,
        'db.t3.small': 2,
        'db.t3.medium': 2,
        'db.t3.large': 2,
        'db.t3.xlarge': 4,
        'db.t3.2xlarge': 8,
        'db.r5.large': 2,
        'db.r5.xlarge': 4,
        'db.r5.2xlarge': 8,
        'db.r5.4xlarge': 16,
        'db.r5.8xlarge': 32,
        'db.r5.12xlarge': 48,
        'db.r5.16xlarge': 64,
        'db.r5.24xlarge': 96,
        'db.r6g.large': 2,
        'db.r6g.xlarge': 4,
        'db.r6g.2xlarge': 8,
        'db.r6g.4xlarge': 16,
        'db.r6g.8xlarge': 32,
        'db.r6g.12xlarge': 48,
        'db.r6g.16xlarge': 64,
        
        // EC2 instance types
        't3.micro': 2,
        't3.small': 2,
        't3.medium': 2,
        't3.large': 2,
        't3.xlarge': 4,
        't3.2xlarge': 8,
        'm5.large': 2,
        'm5.xlarge': 4,
        'm5.2xlarge': 8,
        'm5.4xlarge': 16,
        'm5.8xlarge': 32,
        'm5.12xlarge': 48,
        'm5.16xlarge': 64,
        'm5.24xlarge': 96,
        'c5.large': 2,
        'c5.xlarge': 4,
        'c5.2xlarge': 8,
        'c5.4xlarge': 16,
        'c5.9xlarge': 36,
        'c5.12xlarge': 48,
        'c5.18xlarge': 72,
        'c5.24xlarge': 96,
        'r5.large': 2,
        'r5.xlarge': 4,
        'r5.2xlarge': 8,
        'r5.4xlarge': 16,
        'r5.8xlarge': 32,
        'r5.12xlarge': 48,
        'r5.16xlarge': 64,
        'r5.24xlarge': 96,
        
        // OpenSearch instance types
        'm5.large.search': 2,
        'm5.xlarge.search': 4,
        'm5.2xlarge.search': 8,
        'r6gd.large.search': 2,
        'r6gd.xlarge.search': 4,
        'r6gd.2xlarge.search': 8,
        'r6gd.4xlarge.search': 16,
        'r6gd.8xlarge.search': 32,
        'r6gd.12xlarge.search': 48,
        'r6gd.16xlarge.search': 64,
    };
    
    return instanceCores[instanceType] || 0;
}

// Helper function to generate the markdown report
function generateMarkdownReport(stackName: string, info: ResourceInfo): string {
    let md = '';
    
    // Header
    md += `# Cluster Stack: ${stackName}\n\n`;
    
    // Summary Section - Most Important Information
    md += `## Summary\n\n`;
    
    // Benchmark Target (State Transition Goal)
    if (info.benchmarkWorkers) {
        md += `### 🎯 Benchmark Target\n`;
        md += `- **Target Throughput:** ${info.benchmarkWorkers.target} state transitions/second (sts)\n`;
        md += `- **Namespaces:** ${info.benchmarkWorkers.namespaces}\n\n`;
    }
    
    // Provisioning Ratios
    md += `### 📊 Provisioning Ratios\n`;
    
    if (info.temporalServices && info.benchmarkWorkers) {
        const target = info.benchmarkWorkers.target;
        
        // Calculate total CPU cores for frontend, history, matching
        const frontendCores = (info.temporalServices.frontend?.pods || 0) * (info.temporalServices.frontend?.cpuPerPod || 0);
        const historyCores = (info.temporalServices.history?.pods || 0) * (info.temporalServices.history?.cpuPerPod || 0);
        const matchingCores = (info.temporalServices.matching?.pods || 0) * (info.temporalServices.matching?.cpuPerPod || 0);
        const totalServiceCores = frontendCores + historyCores + matchingCores;
        
        if (totalServiceCores > 0) {
            md += `- **CPU Cores (Frontend + History + Matching):** ${totalServiceCores} cores\n`;
            md += `- **State Transitions per Core:** ${Math.round(target / totalServiceCores)} sts/core\n`;
            
            // Individual service ratios
            if (frontendCores > 0) {
                md += `- **Frontend:** ${frontendCores} cores (${Math.round(target / frontendCores)} sts/core)\n`;
            }
            if (historyCores > 0) {
                md += `- **History:** ${historyCores} cores (${Math.round(target / historyCores)} sts/core)\n`;
            }
            if (matchingCores > 0) {
                md += `- **Matching:** ${matchingCores} cores (${Math.round(target / matchingCores)} sts/core)\n`;
            }
        }
        
        // Database cores per state transition
        if (info.cassandraNodeGroups.length > 0) {
            const cassandraNode = info.cassandraNodeGroups[0];
            const totalCassandraCores = (cassandraNode.cpuRequest || 0) * cassandraNode.nodeCount;
            if (totalCassandraCores > 0) {
                md += `- **Cassandra Database:** ${totalCassandraCores} cores (${Math.round(target / totalCassandraCores)} sts/core)\n`;
            }
        }
        
        if (info.rdsInstances.length > 0) {
            const rdsInstance = info.rdsInstances[0];
            const rdsCores = getInstanceTypeCpuCores(rdsInstance.instanceClass);
            if (rdsCores > 0) {
                md += `- **RDS Database:** ${rdsCores} cores (${Math.round(target / rdsCores)} sts/core)\n`;
            }
        }
    }
    
    md += `\n---\n\n`;
    
    // AWS Region
    md += `## AWS Region\n`;
    md += `- **Region:** ${info.region || 'unknown'}\n`;
    if (info.availabilityZones && info.availabilityZones.length > 0) {
        md += `- **Availability Zones:** ${info.availabilityZones.join(', ')}\n`;
    }
    md += `\n`;
    
    // EKS Node Groups
    md += `## EKS Node Groups\n`;
    if (info.nodeGroups.length === 0) {
        md += `- No EKS node groups found\n\n`;
    } else {
        md += `| Name | Instance Type | Node Count | Purpose |\n`;
        md += `|------|--------------|------------|---------|\n`;
        // Sort node groups by name for deterministic output
        const sortedNodeGroups = [...info.nodeGroups].sort((a, b) => a.name.localeCompare(b.name));
        for (const ng of sortedNodeGroups) {
            const purpose = ng.purpose || 'general';
            md += `| ${ng.name} | ${ng.instanceType} | ${ng.nodeCount} | ${purpose} |\n`;
        }
        md += `\n`;
        
        if (info.eksCluster) {
            md += `- **EKS Control Plane:** ${info.eksCluster.name}\n`;
        }
        
        md += `\n`;
    }
    
    // Persistence
    md += `## Persistence\n`;
    
    // Cassandra Infrastructure (if present)
    if (info.cassandraNodeGroups.length > 0) {
        md += `### Cassandra\n`;
        md += `| Instance Type | Node Count | CPU Request | Memory Request | Storage/Node |\n`;
        md += `|--------------|------------|-------------|----------------|--------------|\n`;
        
        for (const ng of info.cassandraNodeGroups) {
            // Calculate storage per node
            let storagePerNode = 0;
            if (ng.commitLogStorageGB && ng.dataStorageGB) {
                storagePerNode = ng.commitLogStorageGB + ng.dataStorageGB;
            }
            
            const cpuRequest = ng.cpuRequest ? ng.cpuRequest.toString() : '-';
            const memoryRequest = ng.memoryRequest || '-';
            const storageDisplay = storagePerNode > 0 ? `${storagePerNode.toFixed(1)} GB` : '-';
            
            md += `| ${ng.instanceType} | ${ng.nodeCount} | ${cpuRequest} | ${memoryRequest} | ${storageDisplay} |\n`;
        }
        
        md += `\n`;
        
        // Add storage details
        if (info.cassandraNodeGroups.some(ng => ng.commitLogStorageGB || ng.dataStorageGB)) {
            md += `**Storage Details:**\n`;
            for (const ng of info.cassandraNodeGroups) {
                if (ng.commitLogStorageGB || ng.dataStorageGB) {
                    md += `- **Per Node:** ${ng.commitLogStorageGB || 0} GB commit log + ${ng.dataStorageGB || 0} GB data storage (gp3)\n`;
                    md += `- **Total Cluster:** ${((ng.commitLogStorageGB || 0) + (ng.dataStorageGB || 0)) * ng.nodeCount} GB across ${ng.nodeCount} nodes\n`;
                }
            }
            md += `\n`;
        }
    }
    if (info.rdsInstances.length) {
        md += `### RDS\n`;

        const rds = info.rdsInstances[0];
        const rdsCores = getInstanceTypeCpuCores(rds.instanceClass);
        
        md += `- **Engine:** ${rds.engine || '-'} ${rds.engineVersion || ''}\n`;
        md += `- **Instance Type:** ${rds.instanceClass}${rdsCores > 0 ? ` (${rdsCores} CPU cores)` : ''}\n`;
        md += `- **Multi-AZ:** ${rds.multiAz ? 'Yes' : 'No'}\n`;
        md += `- **Storage:** ${rds.storageGB} GB ${rds.storageType ? `(${rds.storageType})` : ''}\n\n`;
    }
    
    // OpenSearch (for visibility when using Cassandra)
    if (info.openSearchInstances.length > 0) {
        md += `### OpenSearch\n`;
        
        for (const openSearch of info.openSearchInstances) {
            // Handle master/data split format vs legacy format
            if (openSearch.masterInstanceType && openSearch.dataInstanceType) {
                // Master/data split format
                const totalInstanceCount = (openSearch.masterInstanceCount || 0) + (openSearch.dataInstanceCount || 0);
                
                md += `| Node Type | Instance Type | Instance Count |\n`;
                md += `|-----------|---------------|----------------|\n`;
                md += `| Master | ${openSearch.masterInstanceType} | ${openSearch.masterInstanceCount || 0} |\n`;
                md += `| Data | ${openSearch.dataInstanceType} | ${openSearch.dataInstanceCount || 0} |\n`;
                md += `| **Total** | - | **${totalInstanceCount}** |\n`;
            } else {
                // Legacy format
                md += `| Instance Type | Instance Count |\n`;
                md += `|---------------|----------------|\n`;
                md += `| ${openSearch.instanceType} | ${openSearch.instanceCount || 0} |\n`;
            }
            
            if (openSearch.engineVersion) {
                md += `\n- **Engine Version:** ${openSearch.engineVersion}\n`;
            }
            
            md += `- **Storage:** NVMe (included with instance)\n`;
        }
        md += `\n`;
    }
    
    
    // Temporal Services
    md += `## Temporal Services\n\n`;
    if (!info.temporalServices) {
        md += `- No Temporal services configuration found\n\n`;
    } else {
        md += `| Service   | Pods | CPU/Pod (Request) | Memory/Pod (Request) | Total CPU | Total Memory | STS/Core |\n`;
        md += `|-----------|------|-------------------|----------------------|-----------|--------------|----------|\n`;
        
        const parseMem = (memStr: string) => {
            if (memStr.endsWith('Gi')) return parseFloat(memStr) * 1024;
            if (memStr.endsWith('Mi')) return parseFloat(memStr);
            return parseFloat(memStr);
        };
        
        const formatMem = (mi: number) => mi >= 1024 ? `${(mi / 1024).toFixed(2)}Gi` : `${mi}Mi`;
        
        // Get target throughput for STS/Core calculation
        const targetThroughput = info.benchmarkWorkers?.target || 0;
        
        const services = ['frontend', 'history', 'matching', 'worker'];
        for (const serviceKey of services) {
            const service = info.temporalServices[serviceKey as keyof typeof info.temporalServices];
            if (service) {
                const totalCpu = service.pods * service.cpuPerPod;
                const memoryMi = parseMem(service.memoryPerPod);
                const totalMemoryMi = service.pods * memoryMi;
                const totalMemory = formatMem(totalMemoryMi);
                
                // Calculate state transitions per core for this service
                const stsPerCore = totalCpu > 0 && targetThroughput > 0 ? 
                    Math.round(targetThroughput / totalCpu) : 
                    '-';
                
                const serviceName = serviceKey.charAt(0).toUpperCase() + serviceKey.slice(1);
                md += `| ${serviceName.padEnd(9)} | ${service.pods}    | ${service.cpuPerPod}               | ${service.memoryPerPod}                | ${totalCpu}       | ${totalMemory}     | ${stsPerCore}    |\n`;
            }
        }
        
        md += `\n`;
        
        // History shards
        if (info.temporalServices.history?.shards) {
            md += `- **History Shards:** ${info.temporalServices.history.shards}\n\n`;
        }
    }
    
    // Benchmark Workers
    md += `## Benchmark Workers\n\n`;
    if (!info.benchmarkWorkers?.workers) {
        md += `- No benchmark workers configuration found\n\n`;
    } else {
        const workers = info.benchmarkWorkers.workers;
        md += `| Pods | CPU (Request) | Memory (Request) | Workflow Pollers | Activity Pollers |\n`;
        md += `|------|---------------|------------------|------------------|------------------|\n`;
        md += `| ${workers.pods} | ${workers.cpuRequest} | ${workers.memoryRequest} | ${workers.workflowPollers} | ${workers.activityPollers} |\n\n`;
    }
            
    return md;
} 