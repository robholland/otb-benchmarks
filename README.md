# Temporal Out-of-the-box Benchmarks

This repository contains configurations for benchmarking Temporal clusters of different sizes (t-shirt sizes) across supported persistence backends.

## Pulumi Infrastructure

The `/infra` directory contains Pulumi configurations for creating EKS clusters with integrated database backends:

- **Infrastructure Components**
  - `/infra/cluster` - EKS cluster configuration with database setup
  - `/infra/env` - Environment configuration

- **Available Configurations**
  - `small-mysql` - Small EKS cluster with MySQL RDS

## Deployment

### Prerequisites

1. Install [AWS CLI](https://aws.amazon.com/cli/)
2. Configure AWS CLI with appropriate credentials
3. Install [Pulumi CLI](https://www.pulumi.com/docs/get-started/install/)
4. Install Node.js (required for Pulumi TypeScript)

### Environment Setup

Before creating a cluster, you need to set up the AWS environment (VPC, subnets, etc.):

**Option 1: Use the provided environment configuration**
```bash
cd infra/env
pulumi stack select <env-stack-name>
pulumi up
```

The output from this stack contains AWS environment details (VPC IDs, subnet IDs, etc.) that you'll need for the cluster configuration.

**Option 2: Use your existing AWS environment**
If you already have an AWS environment set up, you can skip the above step but will need to manually configure the cluster stack with your environment details.

### Creating a Cluster

To create a cluster using Pulumi:

1. Edit the stack configuration to ensure AWS settings are accurate:
   - If you used the `env` Pulumi stack above, use the outputs from that stack
   - If using your own environment, add your VPC, subnet, and other AWS settings

```bash
cd infra/cluster
pulumi stack select small-mysql
# Edit the stack configuration as needed
pulumi config edit
# Or edit the Pulumi.<stack-name>.yaml file directly
```

2. Create the cluster:
```bash
pulumi up
```

This will:
1. Use your configured VPC with public and private subnets
2. Set up an EKS cluster with node groups for services and workloads
3. Create an RDS instance in the private subnets
4. Configure security groups and network access

### Accessing Cluster Outputs

After stack creation, you can retrieve outputs using:

```bash
pulumi stack output
```

### Connecting to the EKS Cluster

After the stack is created, configure kubectl to communicate with your cluster:

```bash
cd infra/cluster
./fetch-kubeconfig
```

## Benchmarking

The cluster Pulumi stacks automatically install Temporal and benchmark-workers based on the stack's configuration. No additional steps are required to set up the benchmarking environment.

### Monitoring Benchmark Performance

An in-cluster Grafana instance is deployed with the cluster that provides visibility into both Kubernetes and Temporal metrics. To access Grafana:

```bash
# Port-forward the Grafana service to your local machine
kubectl port-forward -n monitoring service/kube-prometheus-stack-grafana 8080:80
```

Then open http://localhost:8080 in your browser to access the Grafana dashboard. The username password are: 'admin' and 'prom-operator' as per the default `kube-prometheus-stack` configuration.

The dashboards include:
- Kubernetes cluster metrics
- Temporal server performance metrics
- Benchmark worker metrics

You can use these dashboards to evaluate the performance of your Temporal deployment under the configured benchmark load. 