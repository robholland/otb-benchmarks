# Cluster Stack: medium-mysql

## Summary

### 💰 Total Estimated Monthly Cost
**$2572.24**

### 🎯 Benchmark Target
- **Target Throughput:** 1500 state transitions/second

---

## AWS Region
- **Region:** us-west-2
- **Availability Zones:** us-west-2a, us-west-2b, us-west-2c

## EKS Node Groups
| Name | Instance Type | Node Count | Cost/Node/Hour | Monthly Cost |
|------|--------------|------------|----------------|-------------|
| medium-mysql-worker | c5.large | 1 | $0.0850 | $61.20 |
| medium-mysql-temporal | c5.2xlarge | 3 | $0.3400 | $734.40 |
| medium-mysql | m5.2xlarge | 1 | $0.3840 | $276.48 |

- **Total EKS Monthly Cost:** $1072.08

## RDS (Persistence)
- **Engine:** mysql 8.4.5
- **Instance Type:** db.r5.2xlarge
- **Multi-AZ:** Yes
- **Storage:** 1024 GB *(configured for benchmark setup - real deployments would likely need much higher storage)*
- **Instance Cost:** $1382.40/month
- **Storage Cost:** $117.76/month
- **Total Monthly Cost:** $1500.16

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
| 1 | 0.25 | 50Mi | 100 | 150 |

## Benchmark Runner

| Pods | CPU (Request) | Memory (Request) | Concurrent Workflows | Target |
|------|---------------|------------------|--------------------- |--------|
| 1 | 0.25 | 50Mi | 20 | 1500 |

