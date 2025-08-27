# Cluster Stack: large-mysql

## Summary

### 💰 Total Estimated Monthly Cost
**$8517.28**

### 🎯 Benchmark Target
- **Target Throughput:** 5000 state transitions/second

---

## AWS Region
- **Region:** us-west-2
- **Availability Zones:** us-west-2a, us-west-2b, us-west-2c

## EKS Node Groups
| Name | Instance Type | Node Count | Cost/Node/Hour | Monthly Cost |
|------|--------------|------------|----------------|-------------|
| cluster-worker | c5.xlarge | 3 | $0.1700 | $367.20 |
| cluster-core | r5.xlarge | 3 | $0.2520 | $544.32 |
| cluster-temporal | c5.4xlarge | 4 | $0.6800 | $1958.40 |

- **Total EKS Monthly Cost:** $2869.92

## RDS (Persistence)
- **Engine:** mysql 8.4.5
- **Instance Type:** db.r5.8xlarge
- **Multi-AZ:** Yes
- **Storage:** 1024 GB *(configured for benchmark setup - real deployments would likely need much higher storage)*
- **Instance Cost:** $5529.60/month
- **Storage Cost:** $117.76/month
- **Total Monthly Cost:** $5647.36

## Temporal Services

| Service   | Pods | CPU/Pod (Request) | Memory/Pod (Request) | Total CPU | Total Memory |
|-----------|------|-------------------|----------------------|-----------|-------------|
| Frontend  | 6    | 2               | 256Mi                | 12       | 1.50Gi     |
| History   | 12    | 2               | 4.00Gi                | 24       | 48.00Gi     |
| Matching  | 6    | 1               | 256Mi                | 6       | 1.50Gi     |
| Worker    | 2    | 0.25               | 128Mi                | 0.5       | 256Mi     |

- **History Shards:** 1024

## Benchmark Workers

| Pods | CPU (Request) | Memory (Request) | Workflow Pollers | Activity Pollers |
|------|---------------|------------------|------------------|------------------|
| 4 | 1 | 50Mi | 100 | 150 |

## Benchmark Runner

| Pods | CPU (Request) | Memory (Request) | Concurrent Workflows | Target |
|------|---------------|------------------|--------------------- |--------|
| 1 | 0.25 | 50Mi | 90 | 5000 |

