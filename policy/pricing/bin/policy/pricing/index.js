"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateMarkdownReport = void 0;
const pulumi = require("@pulumi/pulumi");
const fs = require("fs");
const path = require("path");
const policy_1 = require("@pulumi/policy");
const pricing_data_1 = require("./pricing-data");
// Report directory
const REPORT_DIRECTORY = "../../reports";
let pricingCache = {};
/**
 * Pricing policies to estimate AWS infrastructure costs
 */
new policy_1.PolicyPack("pricing", {
    policies: [
        {
            name: "stack-resources-pricing-report",
            description: "Analyzes all resources in the stack to generate a comprehensive pricing report",
            enforcementLevel: "advisory",
            validateStack: (args, reportViolation) => __awaiter(void 0, void 0, void 0, function* () {
                var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
                const stackName = pulumi.getStack();
                // Access configuration directly using Pulumi Config API
                const config = new pulumi.Config();
                const awsConfig = config.getObject('AWS');
                const temporalConfig = config.getObject('Temporal');
                const benchmarkConfig = config.getObject('Benchmark');
                const persistenceConfig = config.getObject('Persistence');
                // Initialize pricing service
                const region = (awsConfig === null || awsConfig === void 0 ? void 0 : awsConfig.Region) || 'us-east-1';
                const pricingService = new pricing_data_1.LocalAWSPricingService();
                // Initialize resource info collection
                const resourceInfo = {
                    nodeGroups: [],
                    rdsInstances: []
                };
                // Set region and availability zones from config
                if (awsConfig) {
                    resourceInfo.region = awsConfig.Region;
                    resourceInfo.availabilityZones = awsConfig.AvailabilityZones;
                }
                // Cache for launch template instance types
                const launchTemplateCache = {};
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
                            const eksPrice = yield pricingService.getEKSPricing(region);
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
                            const nodePrice = yield pricingService.getEC2Pricing(instanceType, region);
                            // Store the node group info for reporting
                            resourceInfo.nodeGroups.push({
                                name: resource.name,
                                instanceType,
                                nodeCount,
                                pricePerHour: nodePrice
                            });
                            break;
                        case "aws:rds/instance:Instance":
                            const rdsInstance = resource.props;
                            const instanceClass = rdsInstance.instanceClass || "db.t3.medium";
                            const engine = rdsInstance.engine || ((_a = persistenceConfig === null || persistenceConfig === void 0 ? void 0 : persistenceConfig.RDS) === null || _a === void 0 ? void 0 : _a.Engine) || "postgres";
                            const rdsPrice = yield pricingService.getRDSPricing(instanceClass, engine, region);
                            resourceInfo.rdsInstances.push({
                                name: resource.name,
                                instanceClass,
                                storageGB: rdsInstance.allocatedStorage || 1024,
                                storageType: rdsInstance.storageType,
                                engine: rdsInstance.engine,
                                engineVersion: rdsInstance.engineVersion,
                                multiAz: rdsInstance.multiAz,
                                pricePerHour: rdsPrice,
                                storagePricePerGBMonth: yield pricingService.getRDSStoragePricing(rdsInstance.storageType || 'standard', region)
                            });
                            break;
                    }
                }
                // Process Temporal services configuration
                if (temporalConfig) {
                    const parseCpu = (val) => typeof val === 'string' ? parseFloat(val) : val;
                    const parseMem = (val) => {
                        if (typeof val === 'number')
                            return val;
                        if (!val)
                            return 0;
                        if (val.endsWith('Gi'))
                            return parseFloat(val) * 1024;
                        if (val.endsWith('Mi'))
                            return parseFloat(val);
                        return parseFloat(val);
                    };
                    const formatMem = (mi) => mi >= 1024 ? `${(mi / 1024).toFixed(2)}Gi` : `${mi}Mi`;
                    resourceInfo.temporalServices = {};
                    if (temporalConfig.Frontend) {
                        const frontend = temporalConfig.Frontend;
                        const pods = frontend.Pods || 0;
                        const cpuPerPod = parseCpu(((_b = frontend.CPU) === null || _b === void 0 ? void 0 : _b.Request) || 0);
                        const memoryPerPod = parseMem(((_c = frontend.Memory) === null || _c === void 0 ? void 0 : _c.Request) || '0Mi');
                        resourceInfo.temporalServices.frontend = {
                            pods,
                            cpuPerPod,
                            memoryPerPod: formatMem(memoryPerPod)
                        };
                    }
                    if (temporalConfig.History) {
                        const history = temporalConfig.History;
                        const pods = history.Pods || 0;
                        const cpuPerPod = parseCpu(((_d = history.CPU) === null || _d === void 0 ? void 0 : _d.Request) || 0);
                        const memoryPerPod = parseMem(((_e = history.Memory) === null || _e === void 0 ? void 0 : _e.Request) || '0Mi');
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
                        const cpuPerPod = parseCpu(((_f = matching.CPU) === null || _f === void 0 ? void 0 : _f.Request) || 0);
                        const memoryPerPod = parseMem(((_g = matching.Memory) === null || _g === void 0 ? void 0 : _g.Request) || '0Mi');
                        resourceInfo.temporalServices.matching = {
                            pods,
                            cpuPerPod,
                            memoryPerPod: formatMem(memoryPerPod)
                        };
                    }
                    if (temporalConfig.Worker) {
                        const worker = temporalConfig.Worker;
                        const pods = worker.Pods || 0;
                        const cpuPerPod = parseCpu(((_h = worker.CPU) === null || _h === void 0 ? void 0 : _h.Request) || 0);
                        const memoryPerPod = parseMem(((_j = worker.Memory) === null || _j === void 0 ? void 0 : _j.Request) || '0Mi');
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
                            cpuRequest: ((_k = workers.CPU) === null || _k === void 0 ? void 0 : _k.Request) || '-',
                            memoryRequest: ((_l = workers.Memory) === null || _l === void 0 ? void 0 : _l.Request) || '-',
                            workflowPollers: workers.WorkflowPollers || 0,
                            activityPollers: workers.ActivityPollers || 0
                        };
                    }
                    if (benchmarkConfig.SoakTest) {
                        const soakTest = benchmarkConfig.SoakTest;
                        resourceInfo.benchmarkWorkers.soakTest = {
                            pods: soakTest.Pods || 0,
                            cpuRequest: ((_m = soakTest.CPU) === null || _m === void 0 ? void 0 : _m.Request) || '-',
                            memoryRequest: ((_o = soakTest.Memory) === null || _o === void 0 ? void 0 : _o.Request) || '-',
                            concurrentWorkflows: soakTest.ConcurrentWorkflows || 0,
                            target: soakTest.Target || 0
                        };
                    }
                }
                // Update RDS engine/version from config if available
                if ((persistenceConfig === null || persistenceConfig === void 0 ? void 0 : persistenceConfig.RDS) && resourceInfo.rdsInstances.length > 0) {
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
                for (const rds of resourceInfo.rdsInstances) {
                    if (!rds.pricePerHour) {
                        throw new Error(`Missing instance pricing data for RDS instance ${rds.name} with instance class ${rds.instanceClass}`);
                    }
                    if (!rds.storagePricePerGBMonth) {
                        throw new Error(`Missing storage pricing data for RDS instance ${rds.name} with storage type ${rds.storageType || 'standard'}`);
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
                }
                catch (error) {
                    reportViolation(`Failed to save report: ${error}`);
                }
            }),
        },
    ],
});
// Helper function to generate the markdown report
function generateMarkdownReport(stackName, info) {
    var _a, _b, _c;
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
    }
    else {
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
        // Total EKS cost
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
    // RDS Instances
    md += `## RDS (Persistence)\n`;
    if (info.rdsInstances.length === 0) {
        md += `- No RDS instances found\n\n`;
    }
    else {
        const rds = info.rdsInstances[0]; // Assuming there's one main RDS instance
        if (!rds.pricePerHour) {
            throw new Error(`Missing pricing data for RDS instance ${rds.name} with instance class ${rds.instanceClass}`);
        }
        // Use API-fetched pricing
        const instancePricePerHour = rds.pricePerHour;
        const instanceMonthlyPrice = instancePricePerHour * 24 * 30;
        const storageMonthlyPrice = rds.storageGB * rds.storagePricePerGBMonth;
        const totalMonthlyPrice = instanceMonthlyPrice + storageMonthlyPrice;
        md += `- **Engine:** ${rds.engine || '-'} ${rds.engineVersion || ''}\n`;
        md += `- **Instance Type:** ${rds.instanceClass}\n`;
        md += `- **Multi-AZ:** ${rds.multiAz ? 'Yes' : 'No'}\n`;
        md += `- **Storage:** ${rds.storageGB} GB *(configured for benchmark setup - real deployments would likely need much higher storage)*\n`;
        md += `- **Instance Cost:** $${instanceMonthlyPrice.toFixed(2)}/month\n`;
        md += `- **Storage Cost:** $${storageMonthlyPrice.toFixed(2)}/month\n`;
        md += `- **Total Monthly Cost:** $${totalMonthlyPrice.toFixed(2)}\n\n`;
    }
    // Temporal Services
    md += `## Temporal Services\n\n`;
    if (!info.temporalServices) {
        md += `- No Temporal services configuration found\n\n`;
    }
    else {
        md += `| Service   | Pods | CPU/Pod (Request) | Memory/Pod (Request) | Total CPU | Total Memory |\n`;
        md += `|-----------|------|-------------------|----------------------|-----------|-------------|\n`;
        const parseMem = (memStr) => {
            if (memStr.endsWith('Gi'))
                return parseFloat(memStr) * 1024;
            if (memStr.endsWith('Mi'))
                return parseFloat(memStr);
            return parseFloat(memStr);
        };
        const formatMem = (mi) => mi >= 1024 ? `${(mi / 1024).toFixed(2)}Gi` : `${mi}Mi`;
        const services = ['frontend', 'history', 'matching', 'worker'];
        for (const serviceKey of services) {
            const service = info.temporalServices[serviceKey];
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
        if ((_a = info.temporalServices.history) === null || _a === void 0 ? void 0 : _a.shards) {
            md += `- **History Shards:** ${info.temporalServices.history.shards}\n\n`;
        }
    }
    // Benchmark Workers
    md += `## Benchmark Workers\n\n`;
    if (!((_b = info.benchmarkWorkers) === null || _b === void 0 ? void 0 : _b.workers)) {
        md += `- No benchmark workers configuration found\n\n`;
    }
    else {
        const workers = info.benchmarkWorkers.workers;
        md += `| Pods | CPU (Request) | Memory (Request) | Workflow Pollers | Activity Pollers |\n`;
        md += `|------|---------------|------------------|------------------|------------------|\n`;
        md += `| ${workers.pods} | ${workers.cpuRequest} | ${workers.memoryRequest} | ${workers.workflowPollers} | ${workers.activityPollers} |\n\n`;
    }
    // Benchmark Runner (formerly Soak Test)
    md += `## Benchmark Runner\n\n`;
    if (!((_c = info.benchmarkWorkers) === null || _c === void 0 ? void 0 : _c.soakTest)) {
        md += `- No benchmark runner configuration found\n\n`;
    }
    else {
        const runner = info.benchmarkWorkers.soakTest;
        md += `| Pods | CPU (Request) | Memory (Request) | Concurrent Workflows | Target |\n`;
        md += `|------|---------------|------------------|--------------------- |--------|\n`;
        md += `| ${runner.pods} | ${runner.cpuRequest} | ${runner.memoryRequest} | ${runner.concurrentWorkflows} | ${runner.target} |\n\n`;
    }
    // Total cost summary
    md += `\n## Cost Summary\n\n`;
    let totalMonthlyCost = 0;
    if (info.eksCluster) {
        if (!info.eksCluster.pricePerHour) {
            throw new Error(`Missing pricing data for EKS cluster in cost summary`);
        }
        totalMonthlyCost += info.eksCluster.pricePerHour * 24 * 30;
    }
    // Node group costs
    totalMonthlyCost += info.nodeGroups.reduce((sum, ng) => {
        if (!ng.pricePerHour) {
            throw new Error(`Missing pricing data for node group ${ng.name} in cost summary`);
        }
        return sum + (ng.pricePerHour * ng.nodeCount * 24 * 30);
    }, 0);
    // RDS costs
    if (info.rdsInstances.length > 0) {
        const rds = info.rdsInstances[0];
        if (!rds.pricePerHour) {
            throw new Error(`Missing pricing data for RDS instance ${rds.name} in cost summary`);
        }
        const instanceMonthlyPrice = rds.pricePerHour * 24 * 30;
        const storageMonthlyPrice = rds.storageGB * rds.storagePricePerGBMonth;
        totalMonthlyCost += instanceMonthlyPrice + storageMonthlyPrice;
    }
    md += `- **Total Estimated Monthly Cost:** $${totalMonthlyCost.toFixed(2)}\n`;
    return md;
}
exports.generateMarkdownReport = generateMarkdownReport;
//# sourceMappingURL=index.js.map