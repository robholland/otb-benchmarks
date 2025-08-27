# Cluster Stack: small-mysql

## Summary

### 💰 Total Estimated Monthly Cost
**$2740.00**

### 🎯 Benchmark Target
- **Target Throughput:** 500 state transitions/second

- **Namespaces:** 3

---

## AWS Region
- **Region:** us-west-2
- **Availability Zones:** us-west-2a, us-west-2b, us-west-2c

## EKS Node Groups
| Name | Instance Type | Node Count | Cost/Node/Hour | Monthly Cost |
|------|--------------|------------|----------------|-------------|
| cluster-core | m5.2xlarge | 3 | $0.3840 | $829.44 |
| cluster-temporal | c5.2xlarge | 3 | $0.3400 | $734.40 |
| cluster-worker | c5.xlarge | 3 | $0.1700 | $367.20 |

- **Total EKS Monthly Cost:** $1931.04

## Persistence
### RDS
- **Engine:** mysql 8.4.5
- **Instance Type:** db.r5.xlarge
- **Multi-AZ:** Yes
- **Storage:** 1024 GB *(configured for benchmark setup - real deployments would likely need much higher storage)*
- **Instance Cost:** $691.20/month
- **Storage Cost:** $117.76/month
- **Total Monthly Cost:** $808.96

- **Total Persistence Monthly Cost:** $808.96

## Temporal Services

| Service   | Pods | CPU/Pod (Request) | Memory/Pod (Request) | Total CPU | Total Memory |
|-----------|------|-------------------|----------------------|-----------|-------------|
| Frontend  | 3    | 1               | 256Mi                | 3       | 768Mi     |
| History   | 6    | 1               | 4.00Gi                | 6       | 24.00Gi     |
| Matching  | 3    | 1               | 256Mi                | 3       | 768Mi     |
| Worker    | 3    | 0.25               | 128Mi                | 0.75       | 384Mi     |

- **History Shards:** 512

## Benchmark Workers

| Pods | CPU (Request) | Memory (Request) | Workflow Pollers | Activity Pollers |
|------|---------------|------------------|------------------|------------------|
| 3 | 1 | 256Mi | 30 | 50 |

