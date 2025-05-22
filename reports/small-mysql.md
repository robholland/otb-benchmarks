# Cluster Stack: small-mysql

## AWS Region
- **Region:** us-west-2
- **Availability Zones:** us-west-2a, us-west-2b, us-west-2c

## EKS Node Groups
| Name | Instance Type | Node Count | Cost/Node | Monthly Cost |
|------|--------------|------------|-----------|-------------|
| small-mysql-temporal-81f7665 | m5.2xlarge | 1 | $72.00 | $72.00 |
| small-mysql-worker-a7a82f1 | m5.large | 1 | $72.00 | $72.00 |
| small-mysql-e6ad64a | m5.2xlarge | 1 | $72.00 | $72.00 |

- **Total EKS Monthly Cost:** $216.00

## RDS (Persistence)
- **Engine:** mysql 8.4.5
- **Instance Type:** db.r5.xlarge
- **Multi-AZ:** Yes
- **Storage:** 1024 GB
- **Monthly Cost:** $390.40

## Temporal Services

| Service   | Pods | CPU/Pod (Request) | Memory/Pod (Request) | Total CPU | Total Memory |
|-----------|------|-------------------|----------------------|-----------|-------------|
| Frontend  | 2    | 0.5               | 128Mi                | 1       | 256Mi     |
| History   | 2    | 1               | 8.00Gi                | 2       | 16.00Gi     |
| Matching  | 2    | 0.5               | 128Mi                | 1       | 256Mi     |
| Worker    | 2    | 0.25               | 128Mi                | 0.5       | 256Mi     |

- **History Shards:** 512

## Benchmark Workers

| Pods | CPU (Request) | Memory (Request) | Workflow Pollers | Activity Pollers |
|------|---------------|------------------|------------------|------------------|
| 1 | 0.25 | 50Mi | 100 | 150 |

## Benchmark Runner

| Pods | CPU (Request) | Memory (Request) | Concurrent Workflows |
|------|---------------|------------------|---------------------|
| 1 | 0.25 | 50Mi | 6 |


## Cost Summary

- **Total Estimated Monthly Cost:** $606.40

---

*This is an automatically generated report with estimated pricing. Actual AWS costs may vary.*
