"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const aws = require("@pulumi/aws");
const eks = require("@pulumi/eks");
const policy_1 = require("@pulumi/policy");
// Hard-coded price estimates
const eksPricePerHour = 0.10; // $0.10 per hour for EKS control plane
const defaultNodePricePerHour = 0.05; // $0.05 per hour per default node
const rdsPricePerHour = 0.20; // $0.20 per hour for RDS instance
const auroraClusterPricePerHour = 0.30; // $0.30 per hour for Aurora cluster
/**
 * Pricing policies to estimate AWS infrastructure costs
 */
new policy_1.PolicyPack("pricing", {
    policies: [
        {
            name: "eks-cluster-pricing",
            description: "Reports estimated pricing for EKS clusters.",
            enforcementLevel: "advisory",
            validateResource: (0, policy_1.validateResourceOfType)(aws.eks.Cluster, (cluster, args, reportViolation) => {
                var _a, _b, _c;
                // Calculate control plane cost
                const dailyCost = eksPricePerHour * 24;
                const monthlyCost = dailyCost * 30;
                // Extract node configuration from args
                const nodeCount = ((_a = args.props) === null || _a === void 0 ? void 0 : _a.desiredCapacity) || ((_b = args.props) === null || _b === void 0 ? void 0 : _b.minSize) || 2;
                const instanceType = ((_c = args.props) === null || _c === void 0 ? void 0 : _c.instanceType) || 't3.medium';
                // In reality, this would be a lookup based on instance type
                let nodePricePerHour = defaultNodePricePerHour;
                if (instanceType.startsWith("m5.") || instanceType.startsWith("c5.")) {
                    nodePricePerHour = 0.10; // Higher price for larger instances
                }
                else if (instanceType.startsWith("r5.")) {
                    nodePricePerHour = 0.15; // Higher price for memory-optimized instances
                }
                const nodeHourlyCost = nodePricePerHour * nodeCount;
                const nodeDailyCost = nodeHourlyCost * 24;
                const nodeMonthlyCount = nodeDailyCost * 30;
                const totalHourlyCost = eksPricePerHour + nodeHourlyCost;
                const totalDailyCost = dailyCost + nodeDailyCost;
                const totalMonthlyCost = monthlyCost + nodeMonthlyCount;
                reportViolation(`EKS Cluster estimated pricing: \n` +
                    `  - Control plane: $${eksPricePerHour.toFixed(2)}/hour, $${dailyCost.toFixed(2)}/day, $${monthlyCost.toFixed(2)}/month\n` +
                    `  - Default node group (${nodeCount} ${instanceType} nodes): $${nodeHourlyCost.toFixed(2)}/hour, $${nodeDailyCost.toFixed(2)}/day, $${nodeMonthlyCount.toFixed(2)}/month\n` +
                    `  - Total: $${totalHourlyCost.toFixed(2)}/hour, $${totalDailyCost.toFixed(2)}/day, $${totalMonthlyCost.toFixed(2)}/month\n` +
                    `This is a basic estimate based on the cluster's configured node capacity.`);
            }),
        },
        {
            name: "eks-nodegroup-pricing",
            description: "Reports estimated pricing for EKS node groups.",
            enforcementLevel: "advisory",
            validateResource: (0, policy_1.validateResourceOfType)(eks.NodeGroupV2, (nodeGroup, args, reportViolation) => {
                // Extract nodeGroup properties
                const nodeCount = nodeGroup.desiredCapacity || nodeGroup.maxSize || nodeGroup.minSize || 1;
                const instanceType = nodeGroup.instanceType || 't3.medium';
                // In reality, this would be a lookup based on instance type
                let nodePricePerHour = defaultNodePricePerHour;
                if (instanceType.startsWith("m5.") || instanceType.startsWith("c5.")) {
                    nodePricePerHour = 0.10; // Higher price for larger instances
                }
                else if (instanceType.startsWith("r5.")) {
                    nodePricePerHour = 0.15; // Higher price for memory-optimized instances
                }
                const hourlyPrice = nodePricePerHour * nodeCount;
                const dailyPrice = hourlyPrice * 24;
                const monthlyPrice = dailyPrice * 30;
                reportViolation(`EKS Node Group (${instanceType}) estimated pricing: \n` +
                    `  - ${nodeCount} nodes: $${hourlyPrice.toFixed(2)}/hour, $${dailyPrice.toFixed(2)}/day, $${monthlyPrice.toFixed(2)}/month\n` +
                    `This is a basic estimate based on instance type and max node count.`);
            }),
        },
        {
            name: "rds-instance-pricing",
            description: "Reports estimated pricing for RDS instances.",
            enforcementLevel: "advisory",
            validateResource: (0, policy_1.validateResourceOfType)(aws.rds.Instance, (instance, args, reportViolation) => {
                const instanceClass = instance.instanceClass || "db.t3.medium";
                // In reality, this would be a lookup based on instance class and engine
                let instancePricePerHour = rdsPricePerHour;
                if (instanceClass.includes("large")) {
                    instancePricePerHour = 0.40; // Higher price for larger instances
                }
                else if (instanceClass.includes("xlarge")) {
                    instancePricePerHour = 0.80; // Higher price for extra large instances
                }
                const dailyPrice = instancePricePerHour * 24;
                const monthlyPrice = dailyPrice * 30;
                // Add storage costs (simplified)
                const storageGB = instance.allocatedStorage || 20;
                const storageMonthlyPrice = storageGB * 0.10; // $0.10 per GB per month
                const totalMonthlyPrice = monthlyPrice + storageMonthlyPrice;
                reportViolation(`RDS Instance (${instanceClass}) estimated pricing: \n` +
                    `  - Instance: $${instancePricePerHour.toFixed(2)}/hour, $${dailyPrice.toFixed(2)}/day, $${monthlyPrice.toFixed(2)}/month\n` +
                    `  - Storage (${storageGB} GB): $${storageMonthlyPrice.toFixed(2)}/month\n` +
                    `  - Total monthly: $${totalMonthlyPrice.toFixed(2)}/month\n` +
                    `This is a basic estimate based on instance class and storage allocation.`);
            }),
        },
        {
            name: "rds-cluster-pricing",
            description: "Reports estimated pricing for RDS Aurora clusters.",
            enforcementLevel: "advisory",
            validateResource: (0, policy_1.validateResourceOfType)(aws.rds.Cluster, (cluster, args, reportViolation) => {
                // For Aurora, we need to consider the cluster endpoints + instance nodes
                // Simplified for this example
                const instanceCount = 2; // Typical minimum for Aurora is 2 instances
                const hourlyPrice = auroraClusterPricePerHour * instanceCount;
                const dailyPrice = hourlyPrice * 24;
                const monthlyPrice = dailyPrice * 30;
                // Add storage costs (simplified)
                // Aurora storage is different - charged based on actual usage
                const estimatedStorageGB = 100;
                const storageMonthlyPrice = estimatedStorageGB * 0.10; // $0.10 per GB per month
                const totalMonthlyPrice = monthlyPrice + storageMonthlyPrice;
                reportViolation(`RDS Aurora Cluster estimated pricing: \n` +
                    `  - ${instanceCount} instances: $${hourlyPrice.toFixed(2)}/hour, $${dailyPrice.toFixed(2)}/day, $${monthlyPrice.toFixed(2)}/month\n` +
                    `  - Estimated storage (${estimatedStorageGB} GB): $${storageMonthlyPrice.toFixed(2)}/month\n` +
                    `  - Total monthly: $${totalMonthlyPrice.toFixed(2)}/month\n` +
                    `This is a basic estimate for an Aurora cluster. Actual costs depend on usage patterns.`);
            }),
        },
    ],
});
//# sourceMappingURL=index.js.map