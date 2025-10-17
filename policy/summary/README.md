# Pricing Policy Pack

This Pulumi policy pack analyzes your infrastructure stack and generates a comprehensive pricing report using local pricing data. **The policy automatically downloads and caches AWS pricing data locally to avoid permission issues with the AWS Pricing API.**

## Features

- **Local Pricing Data**: Uses downloaded AWS pricing data stored locally - no AWS API permissions required
- **Automatic Downloads**: Downloads pricing data automatically if not present or outdated
- **Comprehensive Analysis**: Analyzes EKS clusters, EC2 instances, RDS databases, and application workloads
- **Caching**: Implements intelligent caching with automatic refresh after 7 days
- **Reliable**: No dependency on AWS API permissions or network connectivity during policy execution
- **Detailed Reports**: Generates markdown reports with cost breakdowns and resource details

## Supported AWS Services

- **Amazon EKS**: Control plane pricing
- **Amazon EC2**: Instance pricing for all node groups (t3, m5, c5, r5 families and more)
- **Amazon RDS**: Database instance pricing for PostgreSQL, MySQL, Aurora variants
- **Storage**: EBS and RDS storage cost estimates

## Requirements

### No AWS Permissions Required
Unlike the previous version, this policy pack **does not require** any AWS permissions. All pricing data is stored locally.

### Prerequisites
- Node.js and npm
- File system write access for caching pricing data
- Infrastructure resources that exist in AWS pricing catalog

## Usage

```bash
# Run with policy pack
pulumi up --policy-pack policy/pricing

# Or for preview only
pulumi preview --policy-pack policy/pricing

# Build the policy pack
cd policy/pricing
npm run build
```

### Sample Output

When the policy runs successfully:

```
Previewing update (your-stack):
     Type                              Name                               Plan     
     pulumi:pulumi:Stack               your-stack                      
     ├─ eks:index/cluster:Cluster      cluster                         
     ├─ aws:autoscaling/group:Group    cluster-nodeGroup              
     └─ aws:rds/instance:Instance      temporal-db                    

Diagnostics:
  otb-benchmarks:aws:rds/instance:Instance (temporal-db):
    warning: Generated stack resource and pricing report for "your-stack" at ../../reports/your-stack.md. All pricing data retrieved from local pricing cache.
```

When the policy runs for the first time:

```
Downloading AWS pricing data...
AWS pricing data downloaded and cached successfully.
```

## Generated Reports

The policy generates a detailed markdown report saved to `../../reports/{stack-name}.md` containing:

- AWS region and availability zone information
- EKS cluster and node group costs with current pricing
- RDS database instance and storage costs
- Temporal service resource allocations
- Benchmark worker configurations
- Total estimated monthly costs

### Sample Report Content

```markdown
# Cluster Stack: your-stack

*All pricing data retrieved from local pricing cache*

## EKS Node Groups
| Name | Instance Type | Node Count | Cost/Node/Hour | Monthly Cost |
|------|--------------|------------|----------------|-------------|
| cluster-nodeGroup | m5.large | 3 | $0.0960 | $207.36 |

- **EKS Control Plane:** $72.00/month
- **Total EKS Monthly Cost:** $279.36

## RDS (Persistence)
- **Engine:** postgres 13.13
- **Instance Type:** db.t3.medium
- **Instance Cost:** $49.25/month (local pricing cache)
- **Storage Cost:** $10.00/month (local pricing cache)
- **Total Monthly Cost:** $59.25
```

## Configuration

The policy pack requires no additional configuration beyond your existing Pulumi stack configuration. It automatically:

- Detects your AWS region from the stack configuration
- Downloads pricing data if not present locally
- Refreshes pricing data if older than 7 days
- Caches pricing data in the `pricing-data/` directory

## Pricing Data Management

### Automatic Downloads
- Pricing data is automatically downloaded on first run
- Data is stored in `policy/pricing/pricing-data/aws-pricing.json`
- Data includes pricing for major AWS regions and instance types

### Cache Refresh
- Pricing data is automatically refreshed if older than 7 days
- Manual refresh can be triggered by deleting the `pricing-data/` directory
- Fresh data is downloaded on the next policy run

### Supported Regions
- us-east-1, us-east-2, us-west-1, us-west-2
- eu-west-1, eu-west-2, eu-west-3, eu-central-1
- ap-southeast-1, ap-southeast-2, ap-northeast-1, ap-south-1
- sa-east-1, ca-central-1

## Error Handling

The policy pack includes error handling for:

- **Missing Pricing Data**: Downloads data automatically if not present
- **Outdated Data**: Refreshes data if older than 7 days
- **Unsupported Regions**: Provides clear error messages for unsupported regions
- **Unsupported Instance Types**: Provides clear error messages for unsupported instance types
- **File System Issues**: Handles read/write errors gracefully

## Benefits

By using local pricing data, this policy pack provides:

- **No AWS Permissions Required**: Works without any AWS API access
- **Reliable**: No dependency on network connectivity or AWS API availability
- **Fast**: Local data access is much faster than API calls
- **Regional Pricing**: Accurate pricing for your specific AWS region
- **Instance-specific Costs**: Exact pricing for your instance types
- **Engine-specific RDS Pricing**: Accurate database engine pricing
- **Offline Capability**: Works even without internet connectivity (after initial download)

## Troubleshooting

### Missing Instance Type
```
Error: No EC2 pricing data available for instance type: m6i.large in region: us-east-1
```
**Solution**: The instance type is not in the local pricing data. Consider using a supported instance type or updating the pricing data.

### Missing Region
```
Error: No EC2 pricing data available for region: ap-northeast-2
```
**Solution**: The region is not in the local pricing data. Consider using a supported region or updating the pricing data.

### File System Permissions
```
Error: Failed to save pricing data
```
**Solution**: Ensure the policy has write permissions to create the `pricing-data/` directory.

### Manual Data Refresh
To force a refresh of pricing data:

```bash
# Delete the cached data
rm -rf policy/pricing/pricing-data/

# Run the policy again to download fresh data
pulumi preview --policy-pack policy/pricing
```

## Migration from AWS Pricing API Version

If upgrading from the AWS Pricing API version:

- **Benefit**: No AWS permissions required
- **Benefit**: Faster execution with local data
- **Benefit**: Works offline after initial download
- **Change**: Pricing data is now cached locally
- **Change**: Data is refreshed weekly instead of real-time

## Dependencies

- `@pulumi/policy`: Pulumi Policy SDK
- `@pulumi/aws`: AWS provider for resource type detection
- Node.js built-in modules: `fs`, `path` 