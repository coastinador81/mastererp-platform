const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const frontendRoot = path.resolve(projectRoot, '../../../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [frontendRoot];
config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(frontendRoot, 'node_modules'),
];

module.exports = config;
