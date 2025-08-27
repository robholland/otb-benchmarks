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
                var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v;
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
                            // Determine the purpose of this node group
                            let purpose;
                            if (resource.name.includes('-cassandra')) {
                                purpose = 'cassandra';
                            }
                            else if (resource.name.includes('-temporal')) {
                                purpose = 'temporal';
                            }
                            else if (resource.name.includes('-worker')) {
                                purpose = 'worker';
                            }
                            else if (resource.name.includes('-core')) {
                                purpose = 'core';
                            }
                            // If this is a Cassandra node group, store it separately
                            if (purpose === 'cassandra') {
                                resourceInfo.cassandraNodeGroups.push({
                                    name: resource.name,
                                    instanceType,
                                    nodeCount,
                                    pricePerHour: nodePrice,
                                    cpuRequest: (_b = (_a = persistenceConfig === null || persistenceConfig === void 0 ? void 0 : persistenceConfig.Cassandra) === null || _a === void 0 ? void 0 : _a.CPU) === null || _b === void 0 ? void 0 : _b.Request,
                                    memoryRequest: (_d = (_c = persistenceConfig === null || persistenceConfig === void 0 ? void 0 : persistenceConfig.Cassandra) === null || _c === void 0 ? void 0 : _c.Memory) === null || _d === void 0 ? void 0 : _d.Request
                                });
                            }
                            else {
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
                            const engine = rdsInstance.engine || ((_e = persistenceConfig === null || persistenceConfig === void 0 ? void 0 : persistenceConfig.RDS) === null || _e === void 0 ? void 0 : _e.Engine) || "postgres";
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
                        case "aws:opensearch/domain:Domain":
                            const openSearchDomain = resource.props;
                            const clusterConfig = openSearchDomain.clusterConfig || {};
                            const osInstanceType = clusterConfig.instanceType || ((_g = (_f = persistenceConfig === null || persistenceConfig === void 0 ? void 0 : persistenceConfig.Visibility) === null || _f === void 0 ? void 0 : _f.OpenSearch) === null || _g === void 0 ? void 0 : _g.InstanceType) || "m5.large.search";
                            const osInstanceCount = clusterConfig.instanceCount || (((_h = awsConfig === null || awsConfig === void 0 ? void 0 : awsConfig.AvailabilityZones) === null || _h === void 0 ? void 0 : _h.length) || 3);
                            const ebsOptions = openSearchDomain.ebsOptions || {};
                            const osStorageGB = ebsOptions.volumeSize || 100;
                            const openSearchPrice = yield pricingService.getOpenSearchPricing(osInstanceType, region);
                            const openSearchStoragePrice = yield pricingService.getOpenSearchStoragePricing(region);
                            resourceInfo.openSearchInstances.push({
                                name: resource.name,
                                instanceType: osInstanceType,
                                instanceCount: osInstanceCount,
                                storageGB: osStorageGB,
                                engineVersion: openSearchDomain.engineVersion,
                                pricePerHour: openSearchPrice,
                                storagePricePerGBMonth: openSearchStoragePrice
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
                        const cpuPerPod = parseCpu(((_j = frontend.CPU) === null || _j === void 0 ? void 0 : _j.Request) || 0);
                        const memoryPerPod = parseMem(((_k = frontend.Memory) === null || _k === void 0 ? void 0 : _k.Request) || '0Mi');
                        resourceInfo.temporalServices.frontend = {
                            pods,
                            cpuPerPod,
                            memoryPerPod: formatMem(memoryPerPod)
                        };
                    }
                    if (temporalConfig.History) {
                        const history = temporalConfig.History;
                        const pods = history.Pods || 0;
                        const cpuPerPod = parseCpu(((_l = history.CPU) === null || _l === void 0 ? void 0 : _l.Request) || 0);
                        const memoryPerPod = parseMem(((_m = history.Memory) === null || _m === void 0 ? void 0 : _m.Request) || '0Mi');
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
                        const cpuPerPod = parseCpu(((_o = matching.CPU) === null || _o === void 0 ? void 0 : _o.Request) || 0);
                        const memoryPerPod = parseMem(((_p = matching.Memory) === null || _p === void 0 ? void 0 : _p.Request) || '0Mi');
                        resourceInfo.temporalServices.matching = {
                            pods,
                            cpuPerPod,
                            memoryPerPod: formatMem(memoryPerPod)
                        };
                    }
                    if (temporalConfig.Worker) {
                        const worker = temporalConfig.Worker;
                        const pods = worker.Pods || 0;
                        const cpuPerPod = parseCpu(((_q = worker.CPU) === null || _q === void 0 ? void 0 : _q.Request) || 0);
                        const memoryPerPod = parseMem(((_r = worker.Memory) === null || _r === void 0 ? void 0 : _r.Request) || '0Mi');
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
                            cpuRequest: ((_s = workers.CPU) === null || _s === void 0 ? void 0 : _s.Request) || '-',
                            memoryRequest: ((_t = workers.Memory) === null || _t === void 0 ? void 0 : _t.Request) || '-',
                            workflowPollers: workers.WorkflowPollers || 0,
                            activityPollers: workers.ActivityPollers || 0
                        };
                    }
                    if (benchmarkConfig.SoakTest) {
                        const soakTest = benchmarkConfig.SoakTest;
                        resourceInfo.benchmarkWorkers.soakTest = {
                            pods: soakTest.Pods || 0,
                            cpuRequest: ((_u = soakTest.CPU) === null || _u === void 0 ? void 0 : _u.Request) || '-',
                            memoryRequest: ((_v = soakTest.Memory) === null || _v === void 0 ? void 0 : _v.Request) || '-',
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
                for (const cassandraNodeGroup of resourceInfo.cassandraNodeGroups) {
                    if (!cassandraNodeGroup.pricePerHour) {
                        throw new Error(`Missing pricing data for Cassandra node group ${cassandraNodeGroup.name} with instance type ${cassandraNodeGroup.instanceType}`);
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
                    if (!openSearch.pricePerHour) {
                        throw new Error(`Missing instance pricing data for OpenSearch domain ${openSearch.name} with instance type ${openSearch.instanceType}`);
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
    var _a, _b, _c, _d;
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
    // OpenSearch costs
    totalMonthlyCost += info.openSearchInstances.reduce((sum, os) => {
        if (!os.pricePerHour || !os.storagePricePerGBMonth) {
            throw new Error(`Missing pricing data for OpenSearch domain ${os.name} in cost summary`);
        }
        const instanceMonthlyPrice = os.pricePerHour * os.instanceCount * 24 * 30;
        const storageMonthlyPrice = os.storageGB * os.storagePricePerGBMonth;
        return sum + instanceMonthlyPrice + storageMonthlyPrice;
    }, 0);
    // Summary Section - Most Important Information
    md += `## Summary\n\n`;
    md += `### 💰 Total Estimated Monthly Cost\n`;
    md += `**$${totalMonthlyCost.toFixed(2)}**\n\n`;
    // Benchmark Target (State Transition Goal)
    if ((_a = info.benchmarkWorkers) === null || _a === void 0 ? void 0 : _a.soakTest) {
        const runner = info.benchmarkWorkers.soakTest;
        md += `### 🎯 Benchmark Target\n`;
        md += `- **Target Throughput:** ${runner.target} state transitions/second\n\n`;
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
        md += `### Cassandra Infrastructure\n`;
        md += `| Instance Type | Node Count | CPU Request | Memory Request | Cost/Node/Hour | Monthly Cost |\n`;
        md += `|--------------|------------|-------------|----------------|----------------|-------------|\n`;
        let totalCassandraCost = 0;
        for (const ng of info.cassandraNodeGroups) {
            if (!ng.pricePerHour) {
                throw new Error(`Missing pricing data for Cassandra node group ${ng.name} with instance type ${ng.instanceType}`);
            }
            const nodePricePerHour = ng.pricePerHour;
            const nodeMonthlyPrice = nodePricePerHour * 24 * 30;
            const totalMonthlyPrice = nodeMonthlyPrice * ng.nodeCount;
            totalCassandraCost += totalMonthlyPrice;
            const cpuRequest = ng.cpuRequest ? ng.cpuRequest.toString() : '-';
            const memoryRequest = ng.memoryRequest || '-';
            md += `| ${ng.instanceType} | ${ng.nodeCount} | ${cpuRequest} | ${memoryRequest} | $${nodePricePerHour.toFixed(4)} | $${totalMonthlyPrice.toFixed(2)} |\n`;
        }
        md += `\n- **Total Cassandra Infrastructure Cost:** $${totalCassandraCost.toFixed(2)}/month\n\n`;
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
    // OpenSearch (for visibility when using Cassandra)
    if (info.openSearchInstances.length > 0) {
        md += `### OpenSearch (Visibility)\n`;
        md += `| Instance Type | Instance Count | Storage/Instance | Total Storage | Instance Cost/Month | Storage Cost/Month | Total Cost/Month |\n`;
        md += `|---------------|----------------|------------------|---------------|---------------------|--------------------|--------------------|\n`;
        for (const openSearch of info.openSearchInstances) {
            if (!openSearch.pricePerHour || !openSearch.storagePricePerGBMonth) {
                throw new Error(`Missing pricing data for OpenSearch domain ${openSearch.name}`);
            }
            const instancePricePerHour = openSearch.pricePerHour;
            const instanceMonthlyPrice = instancePricePerHour * openSearch.instanceCount * 24 * 30;
            const storageMonthlyPrice = openSearch.storageGB * openSearch.storagePricePerGBMonth;
            const totalMonthlyPrice = instanceMonthlyPrice + storageMonthlyPrice;
            md += `| ${openSearch.instanceType} | ${openSearch.instanceCount} | ${openSearch.storageGB} GB | ${openSearch.storageGB * openSearch.instanceCount} GB | $${instanceMonthlyPrice.toFixed(2)} | $${storageMonthlyPrice.toFixed(2)} | $${totalMonthlyPrice.toFixed(2)} |\n`;
        }
        md += `\n`;
    }
    // Calculate total persistence cost
    let totalPersistenceCost = 0;
    // RDS costs
    if (info.rdsInstances.length > 0) {
        const rds = info.rdsInstances[0];
        totalPersistenceCost += (rds.pricePerHour * 24 * 30) + (rds.storageGB * rds.storagePricePerGBMonth);
    }
    // Cassandra infrastructure costs
    totalPersistenceCost += info.cassandraNodeGroups.reduce((sum, ng) => {
        return sum + (ng.pricePerHour * ng.nodeCount * 24 * 30);
    }, 0);
    // OpenSearch costs
    totalPersistenceCost += info.openSearchInstances.reduce((sum, os) => {
        return sum + (os.pricePerHour * os.instanceCount * 24 * 30) + (os.storageGB * os.storagePricePerGBMonth);
    }, 0);
    if (totalPersistenceCost > 0) {
        md += `- **Total Persistence Monthly Cost:** $${totalPersistenceCost.toFixed(2)}\n\n`;
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
        if ((_b = info.temporalServices.history) === null || _b === void 0 ? void 0 : _b.shards) {
            md += `- **History Shards:** ${info.temporalServices.history.shards}\n\n`;
        }
    }
    // Benchmark Workers
    md += `## Benchmark Workers\n\n`;
    if (!((_c = info.benchmarkWorkers) === null || _c === void 0 ? void 0 : _c.workers)) {
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
    if (!((_d = info.benchmarkWorkers) === null || _d === void 0 ? void 0 : _d.soakTest)) {
        md += `- No benchmark runner configuration found\n\n`;
    }
    else {
        const runner = info.benchmarkWorkers.soakTest;
        md += `| Pods | CPU (Request) | Memory (Request) | Concurrent Workflows | Target |\n`;
        md += `|------|---------------|------------------|--------------------- |--------|\n`;
        md += `| ${runner.pods} | ${runner.cpuRequest} | ${runner.memoryRequest} | ${runner.concurrentWorkflows} | ${runner.target} |\n\n`;
    }
    return md;
}
//# sourceMappingURL=index.js.map