import * as aws from "@pulumi/aws";
import * as eks from "@pulumi/eks";
import * as pulumi from "@pulumi/pulumi";
import * as fs from "fs";
import * as path from "path";
import { PolicyPack, ReportViolation, StackValidationArgs } from "@pulumi/policy";
import { AWSConfig, TemporalConfig, BenchmarkConfig, PersistenceConfig } from "../../infra/cluster/types";
import { LocalAWSPricingService } from "./pricing-data";

// Report directory
const REPORT_DIRECTORY = "../../reports";

// Pricing cache to avoid repeated API calls
interface PricingCache {
    [key: string]: number;
}

let pricingCache: PricingCache = {};

// Resource information interface for reporting
interface ResourceInfo {
    region?: string;
    availabilityZones?: string[];
    eksCluster?: {
        name: string;
        pricePerHour?: number;
    };
    nodeGroups: Array<{
        name: string;
        instanceType: string;
        nodeCount: number;
        pricePerHour?: number;
        purpose?: 'core' | 'temporal' | 'worker' | 'cassandra';
    }>;
    cassandraNodeGroups: Array<{
        name: string;
        instanceType: string;
        nodeCount: number;
        pricePerHour?: number;
        cpuRequest?: number;
        memoryRequest?: string;
        commitLogStorageGB?: number;
        dataStorageGB?: number;
        storagePricePerGBMonth?: number;
    }>;
    rdsInstances: Array<{
        name: string;
        instanceClass: string;
        storageGB: number;
        storageType?: string;
        engine?: string;
        engineVersion?: string;
        multiAz?: boolean;
        pricePerHour?: number;
        storagePricePerGBMonth?: number;
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
        storageGB: number;
        engineVersion?: string;
        masterPricePerHour?: number;
        dataPricePerHour?: number;
        // Legacy fields for backward compatibility
        pricePerHour?: number;
        storagePricePerGBMonth?: number;
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
 * Pricing policies to estimate AWS infrastructure costs
 */
new PolicyPack("pricing", {
    policies: [
        {
            name: "stack-resources-pricing-report",
            description: "Analyzes all resources in the stack to generate a comprehensive pricing report",
            enforcementLevel: "advisory",
            validateStack: async (args: StackValidationArgs, reportViolation: ReportViolation) => {
                const stackName = pulumi.getStack();

                // Access configuration directly using Pulumi Config API
                const config = new pulumi.Config();
                const awsConfig = config.getObject<AWSConfig>('AWS');
                const temporalConfig = config.getObject<TemporalConfig>('Temporal');
                const benchmarkConfig = config.getObject<BenchmarkConfig>('Benchmark');
                const persistenceConfig = config.getObject<PersistenceConfig>('Persistence');
                
                // Initialize pricing service
                const region = awsConfig?.Region || 'us-east-1';
                const pricingService = new LocalAWSPricingService(region);
                
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
                            const eksPrice = await pricingService.getEKSPricing(region);
                            resourceInfo.eksCluster = {
                                name: resource.name,
                                pricePerHour: eksPrice
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
                            
                            const nodePrice = await pricingService.getEC2Pricing(instanceType, region);
                            
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
                                
                                // Get EBS storage pricing (both use gp3 according to PersistenceComponent.ts)
                                const storagePricePerGBMonth = await pricingService.getEBSStoragePricing('gp3', region);
                                
                                resourceInfo.cassandraNodeGroups.push({
                                    name: resource.name,
                                    instanceType,
                                    nodeCount,
                                    pricePerHour: nodePrice,
                                    cpuRequest: persistenceConfig?.Cassandra?.CPU?.Limit,
                                    memoryRequest: persistenceConfig?.Cassandra?.Memory?.Limit,
                                    commitLogStorageGB,
                                    dataStorageGB,
                                    storagePricePerGBMonth
                                });
                            } else {
                                // Store regular node groups (non-Cassandra)
                                resourceInfo.nodeGroups.push({
                                    name: resource.name,
                                    instanceType,
                                    nodeCount,
                                    pricePerHour: nodePrice,
                                    purpose
                                });
                            }
                            break;
                            
                        case "aws:rds/instance:Instance":
                            const rdsInstance = resource.props;
                            const instanceClass = rdsInstance.instanceClass || "db.t3.medium";
                            const engine = rdsInstance.engine || persistenceConfig?.RDS?.Engine || "postgres";
                            
                            const rdsPrice = await pricingService.getRDSPricing(instanceClass, engine, region);
                            
                            resourceInfo.rdsInstances.push({
                                name: resource.name,
                                instanceClass,
                                storageGB: rdsInstance.allocatedStorage || 1024,
                                storageType: rdsInstance.storageType,
                                engine: rdsInstance.engine,
                                engineVersion: rdsInstance.engineVersion,
                                multiAz: rdsInstance.multiAz,
                                pricePerHour: rdsPrice,
                                storagePricePerGBMonth: await pricingService.getRDSStoragePricing(rdsInstance.storageType || 'standard', region)
                            });
                            break;
                            
                        case "aws:opensearch/domain:Domain":
                            const openSearchDomain = resource.props;
                            const clusterConfig = openSearchDomain.clusterConfig || {};
                            const ebsOptions = openSearchDomain.ebsOptions || {};
                            const osStorageGB = ebsOptions.volumeSize || 100;
                            const openSearchStoragePrice = await pricingService.getOpenSearchStoragePricing(region);
                            
                            // Check if dedicated master is enabled (new master/data split format)
                            if (clusterConfig.dedicatedMasterEnabled) {
                                // New format with master/data split
                                const masterInstanceType = clusterConfig.dedicatedMasterType || persistenceConfig?.Visibility?.OpenSearch?.MasterInstanceType || "m5.large.search";
                                const masterInstanceCount = clusterConfig.dedicatedMasterCount || persistenceConfig?.Visibility?.OpenSearch?.MasterInstanceCount || 3;
                                const dataInstanceType = clusterConfig.instanceType || persistenceConfig?.Visibility?.OpenSearch?.DataInstanceType || "r6gd.2xlarge.search";
                                const dataInstanceCount = clusterConfig.instanceCount || persistenceConfig?.Visibility?.OpenSearch?.DataInstanceCount || (awsConfig?.AvailabilityZones?.length || 3);
                                
                                const masterPrice = await pricingService.getOpenSearchPricing(masterInstanceType, region);
                                const dataPrice = await pricingService.getOpenSearchPricing(dataInstanceType, region);
                                
                                resourceInfo.openSearchInstances.push({
                                    name: resource.name,
                                    masterInstanceType,
                                    masterInstanceCount,
                                    dataInstanceType,
                                    dataInstanceCount,
                                    storageGB: osStorageGB,
                                    engineVersion: openSearchDomain.engineVersion,
                                    masterPricePerHour: masterPrice,
                                    dataPricePerHour: dataPrice,
                                    storagePricePerGBMonth: openSearchStoragePrice
                                });
                            } else {
                                // Legacy format (single instance type) for backward compatibility
                                const osInstanceType = clusterConfig.instanceType || "m5.large.search";
                                const osInstanceCount = clusterConfig.instanceCount || (awsConfig?.AvailabilityZones?.length || 3);
                                
                                const openSearchPrice = await pricingService.getOpenSearchPricing(osInstanceType, region);
                                
                                resourceInfo.openSearchInstances.push({
                                    name: resource.name,
                                    instanceType: osInstanceType,
                                    instanceCount: osInstanceCount,
                                    storageGB: osStorageGB,
                                    engineVersion: openSearchDomain.engineVersion,
                                    pricePerHour: openSearchPrice,
                                    storagePricePerGBMonth: openSearchStoragePrice
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

                // Validate that all pricing data was successfully retrieved
                if (resourceInfo.eksCluster && !resourceInfo.eksCluster.pricePerHour) {
                    throw new Error(`Missing pricing data for EKS cluster ${resourceInfo.eksCluster.name}`);
                }
                
                for (const nodeGroup of resourceInfo.nodeGroups) {
                    if (!nodeGroup.pricePerHour) {
                        throw new Error(`Missing pricing data for node group ${nodeGroup.name} with instance type ${nodeGroup.instanceType}`);
                    }
                }
                
                for (const cassandraNodeGroup of resourceInfo.cassandraNodeGroups) {
                    if (!cassandraNodeGroup.pricePerHour) {
                        throw new Error(`Missing pricing data for Cassandra node group ${cassandraNodeGroup.name} with instance type ${cassandraNodeGroup.instanceType}`);
                    }
                    if (!cassandraNodeGroup.storagePricePerGBMonth) {
                        throw new Error(`Missing storage pricing data for Cassandra node group ${cassandraNodeGroup.name}`);
                    }
                }
                
                for (const rds of resourceInfo.rdsInstances) {
                    if (!rds.pricePerHour) {
                        throw new Error(`Missing instance pricing data for RDS instance ${rds.name} with instance class ${rds.instanceClass}`);
                    }
                    if (!rds.storagePricePerGBMonth) {
                        throw new Error(`Missing storage pricing data for RDS instance ${rds.name} with storage type ${rds.storageType || 'standard'}`);
                    }
                }
                
                for (const openSearch of resourceInfo.openSearchInstances) {
                    // Check pricing data based on master/data split or legacy format
                    if (openSearch.masterInstanceType && openSearch.dataInstanceType) {
                        // Master/data split format
                        if (!openSearch.masterPricePerHour) {
                            throw new Error(`Missing master instance pricing data for OpenSearch domain ${openSearch.name} with master instance type ${openSearch.masterInstanceType}`);
                        }
                        if (!openSearch.dataPricePerHour) {
                            throw new Error(`Missing data instance pricing data for OpenSearch domain ${openSearch.name} with data instance type ${openSearch.dataInstanceType}`);
                        }
                    } else {
                        // Legacy format
                        if (!openSearch.pricePerHour) {
                            throw new Error(`Missing instance pricing data for OpenSearch domain ${openSearch.name} with instance type ${openSearch.instanceType}`);
                        }
                    }
                    if (!openSearch.storagePricePerGBMonth) {
                        throw new Error(`Missing storage pricing data for OpenSearch domain ${openSearch.name}`);
                    }
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
                    
                    reportViolation(`Generated stack resource and pricing report for "${stackName}" at ${reportPath}.`);
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

// Helper function to generate the markdown report
function generateMarkdownReport(stackName: string, info: ResourceInfo): string {
    let md = '';
    
    // Header
    md += `# Cluster Stack: ${stackName}\n\n`;
    
    // Calculate total cost first for the summary
    let totalMonthlyCost = 0;
    
    if (info.eksCluster) {
        if (!info.eksCluster.pricePerHour) {
            throw new Error(`Missing pricing data for EKS cluster in cost summary`);
        }
        totalMonthlyCost += info.eksCluster.pricePerHour * 24 * 30;
    }
    
    // Node group costs (excluding Cassandra which is counted under Persistence)
    totalMonthlyCost += info.nodeGroups.reduce((sum, ng) => {
        if (!ng.pricePerHour) {
            throw new Error(`Missing pricing data for node group ${ng.name} in cost summary`);
        }
        return sum + (ng.pricePerHour * ng.nodeCount * 24 * 30);
    }, 0);
    
    // Cassandra node group costs (will be shown under Persistence)
    totalMonthlyCost += info.cassandraNodeGroups.reduce((sum, ng) => {
        if (!ng.pricePerHour) {
            throw new Error(`Missing pricing data for Cassandra node group ${ng.name} in cost summary`);
        }
        const instanceCost = ng.pricePerHour * ng.nodeCount * 24 * 30;
        
        // Add storage costs for each node
        let storageCost = 0;
        if (ng.storagePricePerGBMonth && ng.commitLogStorageGB && ng.dataStorageGB) {
            const storagePerNode = ng.commitLogStorageGB + ng.dataStorageGB;
            storageCost = storagePerNode * ng.nodeCount * ng.storagePricePerGBMonth;
        }
        
        return sum + instanceCost + storageCost;
    }, 0);

    // RDS costs
    if (info.rdsInstances.length > 0) {
        const rds = info.rdsInstances[0];
        if (!rds.pricePerHour) {
            throw new Error(`Missing pricing data for RDS instance ${rds.name} in cost summary`);
        }
        const instanceMonthlyPrice = rds.pricePerHour * 24 * 30;
        const storageMonthlyPrice = rds.storageGB * rds.storagePricePerGBMonth!;
        totalMonthlyCost += instanceMonthlyPrice + storageMonthlyPrice;
    }
    
    // OpenSearch costs
    totalMonthlyCost += info.openSearchInstances.reduce((sum, os) => {
        if (!os.storagePricePerGBMonth) {
            throw new Error(`Missing storage pricing data for OpenSearch domain ${os.name} in cost summary`);
        }
        
        let instanceMonthlyPrice = 0;
        if (os.masterInstanceType && os.dataInstanceType) {
            // Master/data split format
            if (!os.masterPricePerHour || !os.dataPricePerHour) {
                throw new Error(`Missing instance pricing data for OpenSearch domain ${os.name} in cost summary`);
            }
            instanceMonthlyPrice = (os.masterPricePerHour * (os.masterInstanceCount || 0) + 
                                   os.dataPricePerHour * (os.dataInstanceCount || 0)) * 24 * 30;
        } else {
            // Legacy format
            if (!os.pricePerHour) {
                throw new Error(`Missing instance pricing data for OpenSearch domain ${os.name} in cost summary`);
            }
            instanceMonthlyPrice = os.pricePerHour * (os.instanceCount || 0) * 24 * 30;
        }
        
        const storageMonthlyPrice = os.storageGB * os.storagePricePerGBMonth;
        return sum + instanceMonthlyPrice + storageMonthlyPrice;
    }, 0);
    
    // Summary Section - Most Important Information
    md += `## Summary\n\n`;
    md += `### 💰 Total Estimated Monthly Cost\n`;
    md += `**$${totalMonthlyCost.toFixed(2)}**\n\n`;
    
    // Benchmark Target (State Transition Goal)
    if (info.benchmarkWorkers) {
        md += `### 🎯 Benchmark Target\n`;
        md += `- **Target Throughput:** ${info.benchmarkWorkers.target} state transitions/second\n\n`;
        md += `- **Namespaces:** ${info.benchmarkWorkers.namespaces}\n\n`;
    }
    
    md += `---\n\n`;
    
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
        md += `| Name | Instance Type | Node Count | Cost/Node/Hour | Monthly Cost |\n`;
        md += `|------|--------------|------------|----------------|-------------|\n`;
        for (const ng of info.nodeGroups) {
            if (!ng.pricePerHour) {
                throw new Error(`Missing pricing data for node group ${ng.name} with instance type ${ng.instanceType}`);
            }
            const nodePricePerHour = ng.pricePerHour;
            const nodeMonthlyPrice = nodePricePerHour * 24 * 30;
            const totalMonthlyPrice = nodeMonthlyPrice * ng.nodeCount;
            md += `| ${ng.name} | ${ng.instanceType} | ${ng.nodeCount} | $${nodePricePerHour.toFixed(4)} | $${totalMonthlyPrice.toFixed(2)} |\n`;
        }
        md += `\n`;
        
        // Total EKS cost (excluding Cassandra node groups)
        let totalMonthlyNodeCost = info.nodeGroups.reduce((sum, ng) => {
            if (!ng.pricePerHour) {
                throw new Error(`Missing pricing data for node group ${ng.name}`);
            }
            return sum + (ng.pricePerHour * ng.nodeCount * 24 * 30);
        }, 0);
        let totalEksCost = totalMonthlyNodeCost;
        
        if (info.eksCluster) {
            if (!info.eksCluster.pricePerHour) {
                throw new Error(`Missing pricing data for EKS cluster ${info.eksCluster.name}`);
            }
            const eksMonthlyPrice = info.eksCluster.pricePerHour * 24 * 30;
            totalEksCost += eksMonthlyPrice;
            md += `- **EKS Control Plane:** $${eksMonthlyPrice.toFixed(2)}/month\n`;
        }
        
        md += `- **Total EKS Monthly Cost:** $${totalEksCost.toFixed(2)}\n\n`;
    }
    
    // Persistence
    md += `## Persistence\n`;
    
    // Cassandra Infrastructure (if present)
    if (info.cassandraNodeGroups.length > 0) {
        md += `### Cassandra\n`;
        md += `| Instance Type | Node Count | CPU Request | Memory Request | Cost/Node/Hour | Storage/Node | Storage Cost/Node/Month | Total Monthly Cost |\n`;
        md += `|--------------|------------|-------------|----------------|----------------|--------------|-------------------------|--------------------|\n`;
        
        let totalCassandraCost = 0;
        for (const ng of info.cassandraNodeGroups) {
            if (!ng.pricePerHour) {
                throw new Error(`Missing pricing data for Cassandra node group ${ng.name} with instance type ${ng.instanceType}`);
            }
            const nodePricePerHour = ng.pricePerHour;
            const nodeMonthlyPrice = nodePricePerHour * 24 * 30;
            
            // Calculate storage costs
            let storagePerNode = 0;
            let storageMonthlyPricePerNode = 0;
            if (ng.commitLogStorageGB && ng.dataStorageGB && ng.storagePricePerGBMonth) {
                storagePerNode = ng.commitLogStorageGB + ng.dataStorageGB;
                storageMonthlyPricePerNode = storagePerNode * ng.storagePricePerGBMonth;
            }
            
            const totalMonthlyPricePerNode = nodeMonthlyPrice + storageMonthlyPricePerNode;
            const totalMonthlyPrice = totalMonthlyPricePerNode * ng.nodeCount;
            totalCassandraCost += totalMonthlyPrice;
            
            const cpuRequest = ng.cpuRequest ? ng.cpuRequest.toString() : '-';
            const memoryRequest = ng.memoryRequest || '-';
            const storageDisplay = storagePerNode > 0 ? `${storagePerNode.toFixed(1)} GB` : '-';
            
            md += `| ${ng.instanceType} | ${ng.nodeCount} | ${cpuRequest} | ${memoryRequest} | $${nodePricePerHour.toFixed(4)} | ${storageDisplay} | $${storageMonthlyPricePerNode.toFixed(2)} | $${totalMonthlyPrice.toFixed(2)} |\n`;
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
        
        if (!rds.pricePerHour) {
            throw new Error(`Missing pricing data for RDS instance ${rds.name} with instance class ${rds.instanceClass}`);
        }
        
        // Use API-fetched pricing
        const instancePricePerHour = rds.pricePerHour;
        const instanceMonthlyPrice = instancePricePerHour * 24 * 30;
        const storageMonthlyPrice = rds.storageGB * rds.storagePricePerGBMonth!;
        const totalMonthlyPrice = instanceMonthlyPrice + storageMonthlyPrice;
        
        md += `- **Engine:** ${rds.engine || '-'} ${rds.engineVersion || ''}\n`;
        md += `- **Instance Type:** ${rds.instanceClass}\n`;
        md += `- **Multi-AZ:** ${rds.multiAz ? 'Yes' : 'No'}\n`;
        md += `- **Storage:** ${rds.storageGB} GB *(configured for benchmark setup - real deployments would likely need much higher storage)*\n`;
        md += `- **Instance Cost:** $${instanceMonthlyPrice.toFixed(2)}/month\n`;
        md += `- **Storage Cost:** $${storageMonthlyPrice.toFixed(2)}/month\n`;
        md += `- **Total Monthly Cost:** $${totalMonthlyPrice.toFixed(2)}\n\n`;
    }
    
    // OpenSearch (for visibility when using Cassandra)
    if (info.openSearchInstances.length > 0) {
        md += `### OpenSearch\n`;
        
        for (const openSearch of info.openSearchInstances) {
            if (!openSearch.storagePricePerGBMonth) {
                throw new Error(`Missing storage pricing data for OpenSearch domain ${openSearch.name}`);
            }
            
            const storageMonthlyPrice = openSearch.storageGB * openSearch.storagePricePerGBMonth;
            
            // Handle master/data split format vs legacy format
            if (openSearch.masterInstanceType && openSearch.dataInstanceType) {
                // Master/data split format
                if (!openSearch.masterPricePerHour || !openSearch.dataPricePerHour) {
                    throw new Error(`Missing instance pricing data for OpenSearch domain ${openSearch.name}`);
                }
                
                const masterMonthlyPrice = openSearch.masterPricePerHour * (openSearch.masterInstanceCount || 0) * 24 * 30;
                const dataMonthlyPrice = openSearch.dataPricePerHour * (openSearch.dataInstanceCount || 0) * 24 * 30;
                const totalInstanceMonthlyPrice = masterMonthlyPrice + dataMonthlyPrice;
                const totalMonthlyPrice = totalInstanceMonthlyPrice + storageMonthlyPrice;
                const totalInstanceCount = (openSearch.masterInstanceCount || 0) + (openSearch.dataInstanceCount || 0);
                
                md += `| Node Type | Instance Type | Instance Count | Storage/Instance | Total Storage | Instance Cost/Month | Storage Cost/Month | Total Cost/Month |\n`;
                md += `|-----------|---------------|----------------|------------------|---------------|---------------------|--------------------|--------------------|\n`;
                md += `| Master | ${openSearch.masterInstanceType} | ${openSearch.masterInstanceCount || 0} | ${openSearch.storageGB} GB | ${openSearch.storageGB * totalInstanceCount} GB | $${masterMonthlyPrice.toFixed(2)} | - | $${masterMonthlyPrice.toFixed(2)} |\n`;
                md += `| Data | ${openSearch.dataInstanceType} | ${openSearch.dataInstanceCount || 0} | ${openSearch.storageGB} GB | - | $${dataMonthlyPrice.toFixed(2)} | $${storageMonthlyPrice.toFixed(2)} | $${(dataMonthlyPrice + storageMonthlyPrice).toFixed(2)} |\n`;
                md += `| **Total** | - | **${totalInstanceCount}** | **${openSearch.storageGB} GB** | **${openSearch.storageGB * totalInstanceCount} GB** | **$${totalInstanceMonthlyPrice.toFixed(2)}** | **$${storageMonthlyPrice.toFixed(2)}** | **$${totalMonthlyPrice.toFixed(2)}** |\n`;
            } else {
                // Legacy format
                if (!openSearch.pricePerHour) {
                    throw new Error(`Missing instance pricing data for OpenSearch domain ${openSearch.name}`);
                }
                
                const instancePricePerHour = openSearch.pricePerHour;
                const instanceMonthlyPrice = instancePricePerHour * (openSearch.instanceCount || 0) * 24 * 30;
                const totalMonthlyPrice = instanceMonthlyPrice + storageMonthlyPrice;
                const totalStorage = openSearch.storageGB * (openSearch.instanceCount || 0);
                
                md += `| Instance Type | Instance Count | Storage/Instance | Total Storage | Instance Cost/Month | Storage Cost/Month | Total Cost/Month |\n`;
                md += `|---------------|----------------|------------------|---------------|---------------------|--------------------|--------------------|\n`;
                md += `| ${openSearch.instanceType} | ${openSearch.instanceCount || 0} | ${openSearch.storageGB} GB | ${totalStorage} GB | $${instanceMonthlyPrice.toFixed(2)} | $${storageMonthlyPrice.toFixed(2)} | $${totalMonthlyPrice.toFixed(2)} |\n`;
            }
        }
        md += `\n`;
    }
    
    // Calculate total persistence cost
    let totalPersistenceCost = 0;
    
    // RDS costs
    if (info.rdsInstances.length > 0) {
        const rds = info.rdsInstances[0];
        totalPersistenceCost += (rds.pricePerHour! * 24 * 30) + (rds.storageGB * rds.storagePricePerGBMonth!);
    }
    
    // Cassandra infrastructure costs (including storage)
    totalPersistenceCost += info.cassandraNodeGroups.reduce((sum, ng) => {
        const instanceCost = ng.pricePerHour! * ng.nodeCount * 24 * 30;
        
        // Add storage costs for each node
        let storageCost = 0;
        if (ng.storagePricePerGBMonth && ng.commitLogStorageGB && ng.dataStorageGB) {
            const storagePerNode = ng.commitLogStorageGB + ng.dataStorageGB;
            storageCost = storagePerNode * ng.nodeCount * ng.storagePricePerGBMonth;
        }
        
        return sum + instanceCost + storageCost;
    }, 0);
    
    // OpenSearch costs
    totalPersistenceCost += info.openSearchInstances.reduce((sum, os) => {
        let instanceMonthlyPrice = 0;
        if (os.masterInstanceType && os.dataInstanceType) {
            // Master/data split format
            instanceMonthlyPrice = (os.masterPricePerHour! * (os.masterInstanceCount || 0) + 
                                   os.dataPricePerHour! * (os.dataInstanceCount || 0)) * 24 * 30;
        } else {
            // Legacy format
            instanceMonthlyPrice = os.pricePerHour! * (os.instanceCount || 0) * 24 * 30;
        }
        return sum + instanceMonthlyPrice + (os.storageGB * os.storagePricePerGBMonth!);
    }, 0);
    
    if (totalPersistenceCost > 0) {
        md += `- **Total Persistence Monthly Cost:** $${totalPersistenceCost.toFixed(2)}\n\n`;
    }
    
    // Temporal Services
    md += `## Temporal Services\n\n`;
    if (!info.temporalServices) {
        md += `- No Temporal services configuration found\n\n`;
    } else {
        md += `| Service   | Pods | CPU/Pod (Request) | Memory/Pod (Request) | Total CPU | Total Memory |\n`;
        md += `|-----------|------|-------------------|----------------------|-----------|-------------|\n`;
        
        const parseMem = (memStr: string) => {
            if (memStr.endsWith('Gi')) return parseFloat(memStr) * 1024;
            if (memStr.endsWith('Mi')) return parseFloat(memStr);
            return parseFloat(memStr);
        };
        
        const formatMem = (mi: number) => mi >= 1024 ? `${(mi / 1024).toFixed(2)}Gi` : `${mi}Mi`;
        
        const services = ['frontend', 'history', 'matching', 'worker'];
        for (const serviceKey of services) {
            const service = info.temporalServices[serviceKey as keyof typeof info.temporalServices];
            if (service) {
                const totalCpu = service.pods * service.cpuPerPod;
                const memoryMi = parseMem(service.memoryPerPod);
                const totalMemoryMi = service.pods * memoryMi;
                const totalMemory = formatMem(totalMemoryMi);
                
                const serviceName = serviceKey.charAt(0).toUpperCase() + serviceKey.slice(1);
                md += `| ${serviceName.padEnd(9)} | ${service.pods}    | ${service.cpuPerPod}               | ${service.memoryPerPod}                | ${totalCpu}       | ${totalMemory}     |\n`;
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