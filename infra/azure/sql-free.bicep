// Azure SQL Database using the free offer (serverless, General Purpose) for DocRoof.
// Deploy:  az deployment group create -g <resource-group> -f infra/azure/sql-free.bicep \
//            -p serverName=<globally-unique-name> administratorLogin=<login> administratorPassword=<password>
// The free offer covers one database per subscription. With freeLimitExhaustionBehavior = AutoPause the database
// pauses for the rest of the month when the free allowance is used up, instead of billing.

@description('Globally unique logical server name (lowercase letters, digits, hyphens).')
param serverName string

@description('Azure region, e.g. canadacentral.')
param location string = resourceGroup().location

@description('SQL administrator login (not "sa" or "admin").')
param administratorLogin string

@secure()
@description('SQL administrator password. Provide at deploy time; never commit it.')
param administratorPassword string

param databaseName string = 'docroof'

resource server 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: serverName
  location: location
  properties: {
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorPassword
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

// Render's free plan has no fixed outbound IPs, so the server must accept public connections (TLS-only, strong
// password). docs/DEPLOYMENT.md lists the safer alternatives (static egress IPs or hosting the API in Azure).
resource allowPublic 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = {
  parent: server
  name: 'AllowPublicTls'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '255.255.255.255'
  }
}

resource db 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: server
  name: databaseName
  location: location
  sku: {
    name: 'GP_S_Gen5_2'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: 2
  }
  properties: {
    useFreeLimit: true
    freeLimitExhaustionBehavior: 'AutoPause'
    autoPauseDelay: 60
    minCapacity: json('0.5')
    maxSizeBytes: 34359738368
    zoneRedundant: false
  }
}

output connectionStringTemplate string = 'Server=tcp:${server.properties.fullyQualifiedDomainName},1433;Database=${databaseName};User ID=${administratorLogin};Password=<password>;Encrypt=True;TrustServerCertificate=False;Connection Timeout=90;'
