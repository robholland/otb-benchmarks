import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as eks from "@pulumi/eks";
import * as k8s from "@pulumi/kubernetes";
import { AWSConfig, EKSClusterConfig, PersistenceConfig } from "./types";
import { CapacityCheckerComponent } from "./CapacityCheckerComponent";

export interface ClusterComponentArgs {
    awsConfig: AWSConfig;
    config: EKSClusterConfig;
    persistenceConfig: PersistenceConfig;
}

export class ClusterComponent extends pulumi.ComponentResource {
    public readonly eksCluster: eks.Cluster;
    public readonly provider: k8s.Provider;
    public readonly name: pulumi.Output<string>;
    public readonly kubeconfig: pulumi.Output<any>;
    public readonly securityGroup: pulumi.Output<string>;
    public readonly instanceRoles: pulumi.Output<aws.iam.Role[]>;

    constructor(name: string, args: ClusterComponentArgs, opts?: pulumi.ComponentResourceOptions) {
        super("benchmark:infrastructure:Cluster", name, {}, opts);

        const identity = aws.getCallerIdentity({});
        const role = pulumi.concat('arn:aws:iam::', identity.then(current => current.accountId), ':role/', args.awsConfig.Role);

        const kubeconfigOptions: eks.KubeconfigOptions = { roleArn: role };

        this.eksCluster = new eks.Cluster(name, {
            providerCredentialOpts: kubeconfigOptions,
            vpcId: args.awsConfig.VpcId,
            privateSubnetIds: args.awsConfig.PrivateSubnetIds,
            nodeAssociatePublicIpAddress: false,
            skipDefaultNodeGroup: true,
            corednsAddonOptions: {
                enabled: false,
            },
            createInstanceRole: true,
            createOidcProvider: true,
        }, { parent: this });

        const coreNodeGroup = new eks.NodeGroupV2(name + '-core', {
          cluster: this.eksCluster,
          instanceType: args.config.NodeType,
          nodeAssociatePublicIpAddress: false,
          extraNodeSecurityGroups: this.eksCluster.nodeSecurityGroup.apply(sg => [sg!]),
          desiredCapacity: args.config.NodeCount,
          minSize: args.config.NodeCount,
          maxSize: args.config.NodeCount,
          labels: {
            dedicated: "core",
          },
        }, { parent: this });

        const temporalNodeGroup = new eks.NodeGroupV2(name + '-temporal', {
            cluster: this.eksCluster,
            instanceType: args.config.TemporalNodeType,
            nodeAssociatePublicIpAddress: false,
            extraNodeSecurityGroups: this.eksCluster.nodeSecurityGroup.apply(sg => [sg!]),
            desiredCapacity: args.config.TemporalNodeCount,
            minSize: args.config.TemporalNodeCount,
            maxSize: args.config.TemporalNodeCount,
            labels: {
                dedicated: "temporal",
            },
            taints: {
                "dedicated": { value: "temporal", effect: "NoSchedule" }
            }
        }, { parent: this });

        const workerNodeGroup = new eks.NodeGroupV2(name + '-worker', {
            cluster: this.eksCluster,
            instanceType: args.config.WorkerNodeType,
            nodeAssociatePublicIpAddress: false,
            extraNodeSecurityGroups: this.eksCluster.nodeSecurityGroup.apply(sg => [sg!]),
            desiredCapacity: args.config.WorkerNodeCount,
            minSize: args.config.WorkerNodeCount,
            maxSize: args.config.WorkerNodeCount,
            labels: {
                dedicated: "worker",
            },
            taints: {
                "dedicated": { value: "worker", effect: "NoSchedule" }
            }
        }, { parent: this });

        if (args.persistenceConfig.Cassandra) {
            const cassandraConfig = args.persistenceConfig.Cassandra;

            new eks.NodeGroupV2(name + '-cassandra', {
                cluster: this.eksCluster,
                instanceType: cassandraConfig.NodeType,
                nodeAssociatePublicIpAddress: false,
                extraNodeSecurityGroups: this.eksCluster.nodeSecurityGroup.apply(sg => [sg!]),
                desiredCapacity: cassandraConfig.NodeCount,
                minSize: cassandraConfig.NodeCount,
                maxSize: cassandraConfig.NodeCount,
                labels: {
                    dedicated: "cassandra",
                },
                taints: {
                    "dedicated": { value: "cassandra", effect: "NoSchedule" }
                }
            }, { parent: this });
        }

        const coreCapacity = new CapacityCheckerComponent("core-capacity", {
            nodeSelector: { dedicated: "core" },
            replicas: args.config.NodeCount,
        }, { parent: this, provider: this.eksCluster.provider, dependsOn: [coreNodeGroup] });

        const metricsServer = new aws.eks.Addon("metrics-server", {
          clusterName: this.eksCluster.eksCluster.name,
          addonName: "metrics-server",
          addonVersion: "v0.7.2-eksbuild.3"
        }, { parent: this, dependsOn: [coreCapacity] });

        const ebsAddon = new aws.eks.Addon("aws-ebs-csi-driver", {
            clusterName: this.eksCluster.eksCluster.name,
            addonName: "aws-ebs-csi-driver",
            addonVersion: "v1.47.0-eksbuild.1",
        }, { parent: this, dependsOn: [coreCapacity] });

        this.eksCluster.instanceRoles.apply(roles => {
            roles.forEach((role, i) => {
                new aws.iam.RolePolicyAttachment(`ebs-driver-role-policy-${i}`, { 
                    role: role, 
                    policyArn: "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy" 
                }, { parent: this });
            });
        });

        const gp3StorageClass = new k8s.storage.v1.StorageClass("gp3", {
            metadata: {
                name: "gp3",
            },
            provisioner: "ebs.csi.aws.com",
            parameters: {
                fsType: "ext4",
                type: "gp3",
            },
            reclaimPolicy: "Delete",
            volumeBindingMode: "WaitForFirstConsumer",
            allowVolumeExpansion: true,
        }, { 
            provider: this.eksCluster.provider, 
            dependsOn: [ebsAddon],
            parent: this 
        });

        const corednsAddon = new aws.eks.Addon("coredns", {
          clusterName: this.eksCluster.eksCluster.name,
          addonName: "coredns",
          addonVersion: "v1.12.2-eksbuild.4",
        }, { parent: this, dependsOn: [coreCapacity] });

        // Export the properties that other components need
        this.provider = this.eksCluster.provider;
        this.name = this.eksCluster.eksCluster.name;
        this.kubeconfig = this.eksCluster.kubeconfig;
        this.securityGroup = this.eksCluster.nodeSecurityGroup.apply(sg => sg!.id);
        this.instanceRoles = this.eksCluster.instanceRoles;

        this.registerOutputs({
            provider: this.provider,
            name: this.name,
            kubeconfig: this.kubeconfig,
            securityGroup: this.securityGroup,
            instanceRoles: this.instanceRoles
        });
    }
}
