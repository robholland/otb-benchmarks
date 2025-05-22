import * as aws from "@pulumi/aws";
import * as eks from "@pulumi/eks";
import * as pulumi from "@pulumi/pulumi";
import * as fs from "fs";
import * as path from "path";
import { PolicyPack, ReportViolation, StackValidationArgs } from "@pulumi/policy";
import { AWSConfig, TemporalConfig, BenchmarkConfig, PersistenceConfig } from "../../infra/cluster/types";

// Hard-coded price estimates
const eksPricePerHour = 0.10; // $0.10 per hour for EKS control plane
const defaultNodePricePerHour = 0.05; // $0.05 per hour per default node
const rdsPricePerHour = 0.20; // $0.20 per hour for RDS instance

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
    }>;
    rdsInstances: Array<{
        name: string;
        instanceClass: string;
        storageGB: number;
        engine?: string;
        engineVersion?: string;
        multiAz?: boolean;
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
            concurrentWorkflows: number;
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
            validateStack: (args: StackValidationArgs, reportViolation: ReportViolation) => {
                const stackName = pulumi.getStack();

                // Access configuration directly using Pulumi Config API
                const config = new pulumi.Config();
                const awsConfig = config.getObject<AWSConfig>('AWS');
                const temporalConfig = config.getObject<TemporalConfig>('Temporal');
                const benchmarkConfig = config.getObject<BenchmarkConfig>('Benchmark');
                const persistenceConfig = config.getObject<PersistenceConfig>('Persistence');
                
                // Initialize resource info collection
                const resourceInfo: ResourceInfo = {
                    nodeGroups: [],
                    rdsInstances: []
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
                            const cluster = resource.props;
                            resourceInfo.eksCluster = {
                                name: cluster.name || "eks-cluster",
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
                            
                            // Store the node group info for reporting
                            resourceInfo.nodeGroups.push({
                                name: asg.name || urn.split('/').pop() || "unnamed-node-group",
                                instanceType,
                                nodeCount,
                            });
                            break;
                            
                        case "aws:rds/instance:Instance":
                            const rdsInstance = resource.props;
                            resourceInfo.rdsInstances.push({
                                name: urn.split('/').pop() || "unnamed-rds",
                                instanceClass: rdsInstance.instanceClass || "db.t3.medium",
                                storageGB: rdsInstance.allocatedStorage || 20,
                                engine: rdsInstance.engine,
                                engineVersion: rdsInstance.engineVersion,
                                multiAz: rdsInstance.multiAz,
                            });
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
                    resourceInfo.benchmarkWorkers = {};

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
                            concurrentWorkflows: soakTest.ConcurrentWorkflows || 0
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
                    
                    reportViolation(`Generated stack resource and pricing report for "${stackName}" at ${reportPath}`);
                } catch (error) {
                    reportViolation(`Failed to save report: ${error}`);
                }
            },
        },
    ],
});

// Helper function to generate the markdown report
function generateMarkdownReport(stackName: string, info: ResourceInfo): string {
    let md = '';
    
    // Header
    md += `# Cluster Stack: ${stackName}\n\n`;
    
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
        md += `| Name | Instance Type | Node Count | Cost/Node | Monthly Cost |\n`;
        md += `|------|--------------|------------|-----------|-------------|\n`;
        for (const ng of info.nodeGroups) {
            // Calculate pricing based on instance type
            let nodePricePerHour = defaultNodePricePerHour;
            if (ng.instanceType.startsWith("m5.") || ng.instanceType.startsWith("c5.")) {
                nodePricePerHour = 0.10;
            } else if (ng.instanceType.startsWith("m5.2xl") || ng.instanceType.startsWith("c5.2xl")) {
                nodePricePerHour = 0.20;
            } else if (ng.instanceType.startsWith("r5.")) {
                nodePricePerHour = 0.15;
            }
            
            const nodeMonthlyPrice = nodePricePerHour * 24 * 30;
            const totalMonthlyPrice = nodeMonthlyPrice * ng.nodeCount;
            md += `| ${ng.name} | ${ng.instanceType} | ${ng.nodeCount} | $${nodeMonthlyPrice.toFixed(2)} | $${totalMonthlyPrice.toFixed(2)} |\n`;
        }
        md += `\n`;
        
        // Total EKS cost
        let totalMonthlyNodeCost = info.nodeGroups.reduce((sum, ng) => {
            let nodePricePerHour = defaultNodePricePerHour;
            if (ng.instanceType.startsWith("m5.") || ng.instanceType.startsWith("c5.")) {
                nodePricePerHour = 0.10;
            } else if (ng.instanceType.startsWith("m5.2xl") || ng.instanceType.startsWith("c5.2xl")) {
                nodePricePerHour = 0.20;
            } else if (ng.instanceType.startsWith("r5.")) {
                nodePricePerHour = 0.15;
            }
            return sum + (nodePricePerHour * ng.nodeCount * 24 * 30);
        }, 0);
        let totalEksCost = totalMonthlyNodeCost;
        
        if (info.eksCluster) {
            const eksMonthlyPrice = eksPricePerHour * 24 * 30;
            totalEksCost += eksMonthlyPrice;
            md += `- **EKS Control Plane:** $${eksMonthlyPrice.toFixed(2)}/month\n`;
        }
        
        md += `- **Total EKS Monthly Cost:** $${totalEksCost.toFixed(2)}\n\n`;
    }
    
    // RDS Instances
    md += `## RDS (Persistence)\n`;
    if (info.rdsInstances.length === 0) {
        md += `- No RDS instances found\n\n`;
    } else {
        const rds = info.rdsInstances[0]; // Assuming there's one main RDS instance
        
        // Calculate RDS pricing
        let instancePricePerHour = rdsPricePerHour;
        if (rds.instanceClass.includes("large")) {
            instancePricePerHour = 0.40;
        } else if (rds.instanceClass.includes("xlarge")) {
            instancePricePerHour = 0.80;
        }
        
        const instanceMonthlyPrice = instancePricePerHour * 24 * 30;
        const storageMonthlyPrice = rds.storageGB * 0.10;
        const totalMonthlyPrice = instanceMonthlyPrice + storageMonthlyPrice;
        
        md += `- **Engine:** ${rds.engine || '-'} ${rds.engineVersion || ''}\n`;
        md += `- **Instance Type:** ${rds.instanceClass}\n`;
        md += `- **Multi-AZ:** ${rds.multiAz ? 'Yes' : 'No'}\n`;
        md += `- **Storage:** ${rds.storageGB} GB\n`;
        md += `- **Monthly Cost:** $${totalMonthlyPrice.toFixed(2)}\n\n`;
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
    
    // Benchmark Runner (formerly Soak Test)
    md += `## Benchmark Runner\n\n`;
    if (!info.benchmarkWorkers?.soakTest) {
        md += `- No benchmark runner configuration found\n\n`;
    } else {
        const runner = info.benchmarkWorkers.soakTest;
        md += `| Pods | CPU (Request) | Memory (Request) | Concurrent Workflows |\n`;
        md += `|------|---------------|------------------|---------------------|\n`;
        md += `| ${runner.pods} | ${runner.cpuRequest} | ${runner.memoryRequest} | ${runner.concurrentWorkflows} |\n\n`;
    }
    
    // Total cost summary
    md += `\n## Cost Summary\n\n`;
    
    let totalMonthlyCost = 0;
    
    if (info.eksCluster) {
        totalMonthlyCost += eksPricePerHour * 24 * 30;
    }
    
    // Node group costs
    totalMonthlyCost += info.nodeGroups.reduce((sum, ng) => {
        let nodePricePerHour = defaultNodePricePerHour;
        if (ng.instanceType.startsWith("m5.") || ng.instanceType.startsWith("c5.")) {
            nodePricePerHour = 0.10;
        } else if (ng.instanceType.startsWith("m5.2xl") || ng.instanceType.startsWith("c5.2xl")) {
            nodePricePerHour = 0.20;
        } else if (ng.instanceType.startsWith("r5.")) {
            nodePricePerHour = 0.15;
        }
        return sum + (nodePricePerHour * ng.nodeCount * 24 * 30);
    }, 0);

    // RDS costs
    if (info.rdsInstances.length > 0) {
        const rds = info.rdsInstances[0];
        let instancePricePerHour = rdsPricePerHour;
        if (rds.instanceClass.includes("large")) {
            instancePricePerHour = 0.40;
        } else if (rds.instanceClass.includes("xlarge")) {
            instancePricePerHour = 0.80;
        }
        
        const instanceMonthlyPrice = instancePricePerHour * 24 * 30;
        const storageMonthlyPrice = rds.storageGB * 0.10;
        totalMonthlyCost += instanceMonthlyPrice + storageMonthlyPrice;
    }
    
    md += `- **Total Estimated Monthly Cost:** $${totalMonthlyCost.toFixed(2)}\n`;
    
    md += `\n---\n\n*This is an automatically generated report with estimated pricing. Actual AWS costs may vary.*\n`;
    
    return md;
} 