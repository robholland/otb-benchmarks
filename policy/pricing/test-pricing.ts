#!/usr/bin/env ts-node

import { LocalAWSPricingService } from './pricing-data';

async function testPricingData() {
    console.log('Testing AWS Pricing Data Download...\n');
    
    const pricingService = new LocalAWSPricingService();
    
    try {
        // Force refresh the pricing data
        console.log('Refreshing pricing data...');
        await pricingService.refreshPricingData();
        
        console.log('\n=== Testing EC2 Pricing ===');
        const ec2Price = await pricingService.getEC2Pricing('c5.xlarge', 'us-west-2');
        console.log(`c5.xlarge in us-west-2: $${ec2Price}/hour`);
        
        console.log('\n=== Testing RDS Pricing ===');
        const rdsPrice = await pricingService.getRDSPricing('db.t3.medium', 'postgres', 'us-west-2');
        console.log(`db.t3.medium postgres in us-west-2: $${rdsPrice}/hour`);
        
        console.log('\n=== Testing OpenSearch Pricing ===');
        try {
            const openSearchPrice = await pricingService.getOpenSearchPricing('m5.large.search', 'us-west-2');
            console.log(`m5.large.search in us-west-2: $${openSearchPrice}/hour`);
        } catch (error) {
            console.log(`OpenSearch pricing error: ${error}`);
        }
        
        try {
            const openSearchStoragePrice = await pricingService.getOpenSearchStoragePricing('us-west-2');
            console.log(`OpenSearch storage in us-west-2: $${openSearchStoragePrice}/GB-month`);
        } catch (error) {
            console.log(`OpenSearch storage pricing error: ${error}`);
        }
        
        console.log('\n=== Testing EKS Pricing ===');
        const eksPrice = await pricingService.getEKSPricing('us-west-2');
        console.log(`EKS cluster in us-west-2: $${eksPrice}/hour`);
        
    } catch (error) {
        console.error('Error testing pricing data:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    testPricingData().then(() => {
        console.log('\nPricing data test completed successfully!');
        process.exit(0);
    }).catch((error) => {
        console.error('Test failed:', error);
        process.exit(1);
    });
}
