import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface CapacityCheckerComponentArgs {
    /**
     * Number of replicas to deploy (should match expected node capacity)
     */
    replicas: number;
    
    /**
     * Optional: Tolerations to apply to the pods
     */
    tolerations?: k8s.types.input.core.v1.Toleration[];
    
    /**
     * Optional: Node selector to target specific nodes
     */
    nodeSelector?: { [key: string]: string };
    
    /**
     * Optional: Namespace to deploy in (defaults to "default")
     */
    namespace?: string;
}

export class CapacityCheckerComponent extends pulumi.ComponentResource {
    public readonly deployment: k8s.apps.v1.Deployment;
    public readonly availableReplicas: pulumi.Output<number>;

    constructor(name: string, args: CapacityCheckerComponentArgs, opts?: pulumi.ComponentResourceOptions) {
        super("benchmark:infrastructure:CapacityChecker", name, {}, opts);

        const namespace = args.namespace || "default";
        const appName = `${name}-capacity-checker`;
        const labels = { app: appName, component: "capacity-checker" };

        // Create the deployment with anti-affinity rules
        this.deployment = new k8s.apps.v1.Deployment(appName, {
            metadata: {
                name: appName,
                namespace: namespace,
                labels: labels,
            },
            spec: {
                replicas: args.replicas,
                selector: {
                    matchLabels: labels,
                },
                template: {
                    metadata: {
                        labels: labels,
                    },
                    spec: {
                        // Anti-affinity to ensure pods are spread across different nodes
                        affinity: {
                            podAntiAffinity: {
                                requiredDuringSchedulingIgnoredDuringExecution: [{
                                    labelSelector: {
                                        matchLabels: labels,
                                    },
                                    topologyKey: "kubernetes.io/hostname", // Ensure different nodes
                                }],
                            },
                        },
                        
                        // Apply tolerations if provided
                        tolerations: args.tolerations || [],
                        
                        // Apply node selector if provided
                        nodeSelector: args.nodeSelector || {},
                        
                        // Simple container that just sleeps (minimal resource usage)
                        containers: [{
                            name: "capacity-checker",
                            image: "busybox:1.36",
                            command: ["sleep", "3600"], // Sleep for 1 hour
                            resources: {
                                requests: {
                                    cpu: "1m",      // Minimal CPU request
                                    memory: "1Mi",  // Minimal memory request
                                },
                                limits: {
                                    cpu: "10m",     // Low CPU limit
                                    memory: "10Mi", // Low memory limit
                                },
                            },
                        }],
                        
                        // Restart policy
                        restartPolicy: "Always",
                        
                        // Terminate quickly when deleted
                        terminationGracePeriodSeconds: 5,
                    },
                },
            },
        }, { 
            parent: this 
        });

        // Monitor deployment status
        this.availableReplicas = this.deployment.status.apply(status => 
            status?.availableReplicas || 0
        );

        // Register outputs
        this.registerOutputs({
            availableReplicas: this.availableReplicas,
        });
    }
}
