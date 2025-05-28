# Cluster Stack: small-mysql

## Summary

### 💰 Total Estimated Monthly Cost
**$1707.52**

### 🎯 Benchmark Target
- **Target Throughput:** 500 state transitions/second

---

## AWS Region
- **Region:** us-west-2
- **Availability Zones:** us-west-2a, us-west-2b, us-west-2c

## EKS Node Groups
| Name | Instance Type | Node Count | Cost/Node/Hour | Monthly Cost |
|------|--------------|------------|----------------|-------------|
| small-mysql-worker | m5.large | 1 | $0.0960 | $69.12 |
| small-mysql-temporal | m5.2xlarge | 2 | $0.3840 | $552.96 |
| small-mysql | m5.2xlarge | 1 | $0.3840 | $276.48 |

- **Total EKS Monthly Cost:** $898.56

## RDS (Persistence)
- **Engine:** mysql 8.4.5
- **Instance Type:** db.r5.xlarge
- **Multi-AZ:** Yes
- **Storage:** 1024 GB *(configured for benchmark setup - real deployments would likely need much higher storage)*
- **Instance Cost:** $691.20/month
- **Storage Cost:** $117.76/month
- **Total Monthly Cost:** $808.96

## Temporal Services

| Service   | Pods | CPU/Pod (Request) | Memory/Pod (Request) | Total CPU | Total Memory |
|-----------|------|-------------------|----------------------|-----------|-------------|
| Frontend  | 2    | 1               | 128Mi                | 2       | 256Mi     |
| History   | 2    | 2               | 8.00Gi                | 4       | 16.00Gi     |
| Matching  | 2    | 0.5               | 128Mi                | 1       | 256Mi     |
| Worker    | 2    | 0.25               | 128Mi                | 0.5       | 256Mi     |

- **History Shards:** 512

## Benchmark Workers

| Pods | CPU (Request) | Memory (Request) | Workflow Pollers | Activity Pollers |
|------|---------------|------------------|------------------|------------------|
| 1 | 0.25 | 50Mi | 100 | 150 |

## Benchmark Runner

| Pods | CPU (Request) | Memory (Request) | Concurrent Workflows | Target |
|------|---------------|------------------|--------------------- |--------|
| 2 | 0.25 | 50Mi | 4 | 500 |

