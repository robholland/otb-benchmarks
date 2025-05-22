# Pulumi Pricing Policy Pack

This policy pack analyzes your Pulumi stack resources and generates a comprehensive pricing report with estimated infrastructure costs.

## Current Policies

- **Stack Resources Pricing Report**: A single comprehensive policy that:
  - Analyzes all resources in the stack (EKS clusters, node groups, RDS instances)
  - Reads configuration directly from Pulumi stack configuration
  - Collects information about Temporal services and benchmark workers
  - Generates a detailed markdown report with pricing estimates

## Installation

```bash
npm install
```

## Building

```bash
npm run build
```

## Using the Policy Pack

To use this policy pack with a Pulumi stack:

```bash
pulumi preview --policy-pack .
```

Or to enforce the policies:

```bash
pulumi up --policy-pack .
```

## Report Generation

The policy generates a markdown report with the following sections:
- AWS Region information
- EKS Node Groups with instance types, node counts, per-node costs, and total costs
- RDS (Persistence) details including Multi-AZ configuration
- Temporal Services configuration with resource requests
- Benchmark Workers with poller configuration
- Benchmark Runner (formerly Soak Test) with workload configuration
- Total cost summary

Reports are saved to the `reports/` directory with the stack name as the filename.

## Pricing Details

All pricing is based on hard-coded values for demonstration purposes:
- EKS Control Plane: $0.10/hour
- Default EC2 Node: $0.05/hour (adjusts based on instance type)
  - m5/c5 instances: $0.10/hour
  - m5.2xl/c5.2xl instances: $0.20/hour
  - r5 instances: $0.15/hour
- RDS Instance: $0.20/hour (adjusts based on instance class)
  - large instances: $0.40/hour
  - xlarge instances: $0.80/hour
- Storage: $0.10/GB per month

## Future Enhancements

- Add more AWS resource pricing estimates
- Use API-based pricing instead of hard-coded values
- Add support for different regions and configurations
- Integrate with AWS Price List API for realistic pricing 