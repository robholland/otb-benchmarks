# Cluster Stack: large-mysql

## AWS Region
- **Region:** us-west-2
- **Availability Zones:** us-west-2a, us-west-2b, us-west-2c

## EKS Node Groups
| Name | Instance Type | Node Count | Cost/Node/Hour | Monthly Cost |
|------|--------------|------------|----------------|-------------|
| large-mysql | m5.2xlarge | 1 | $0.3840 | $276.48 |
| large-mysql-temporal | c5.4xlarge | 4 | $0.6800 | $1958.40 |
| large-mysql-worker | c5.large | 1 | $0.0850 | $61.20 |

- **Total EKS Monthly Cost:** $2296.08

## RDS (Persistence)
- **Engine:** mysql 8.4.5
- **Instance Type:** db.r5.4xlarge
- **Multi-AZ:** Yes
- **Storage:** 1024 GB *(configured for benchmark setup - real deployments would likely need much higher storage)*
- **Instance Cost:** $2764.80/month
- **Storage Cost:** $117.76/month
- **Total Monthly Cost:** $2882.56

## Temporal Services

| Service   | Pods | CPU/Pod (Request) | Memory/Pod (Request) | Total CPU | Total Memory |
|-----------|------|-------------------|----------------------|-----------|-------------|
| Frontend  | 2    | 3               | 128Mi                | 6       | 256Mi     |
| History   | 6    | 3               | 4.00Gi                | 18       | 24.00Gi     |
| Matching  | 3    | 2               | 128Mi                | 6       | 384Mi     |
| Worker    | 2    | 0.25               | 128Mi                | 0.5       | 256Mi     |

- **History Shards:** 1024

## Benchmark Workers

| Pods | CPU (Request) | Memory (Request) | Workflow Pollers | Activity Pollers |
|------|---------------|------------------|------------------|------------------|
| 4 | 1 | 50Mi | 100 | 150 |

## Benchmark Runner

| Pods | CPU (Request) | Memory (Request) | Concurrent Workflows |
|------|---------------|------------------|---------------------|
| 2 | 0.25 | 50Mi | 40 |


## Cost Summary

- **Total Estimated Monthly Cost:** $5178.64
