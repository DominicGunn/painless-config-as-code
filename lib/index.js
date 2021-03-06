//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
//

'use strict';

const appRoot = require('app-root-path');
const painlessConfig = require('painless-config');
const path = require('path');

let unconfigured = null;

function objectProvider(json) {
  return {
    get: function get(key) {
      return json[key];
    },
  };
}

function configurePackageEnvironments(providers, environmentModules, environment) {
  for (let i = 0; i < environmentModules.length; i++) {
    // CONSIDER: Should the name strip any @ after the first slash, in case it is a version-appended version?
    const npmName = environmentModules[i].trim();
    if (!npmName) {
      continue;
    }

    let environmentPackage = null;
    try {
      environmentPackage = require(npmName);
    } catch (packageRequireError) {
      const packageMissing = new Error(`Unable to require the "${npmName}" environment package for the "${environment}" environment`);
      packageMissing.innerError = packageRequireError;
      throw packageMissing;
    }
    if (!environmentPackage) {
      continue;
    }

    let values = null;
    if (typeof(environmentPackage) === 'function') {
      try {
        values = environmentPackage(environment);
      } catch (problemCalling) {
        const error = new Error(`While calling the environment package "${npmName}" for the "${environment}" environment an error was thrown`);
        error.innerError = problemCalling;
        throw error;
      }
    } else if (typeof(environmentPackage) === 'object') {
      values = environmentPackage;
    }

    if (!values) {
      throw new Error(`Could not determine what to do with the environment package "${npmName}" for the "${environment}" environment (no values or unexpected type)`);
    }
    providers.push(objectProvider(values));
  }
}

function configureLocalEnvironment(providers, appRoot, directoryName, environment) {
  const envFile = `${environment}.json`;
  const envPath = path.join(appRoot, directoryName, envFile);
  try {
    const json = require(envPath);
    providers.push(objectProvider(json));
  } catch (noFile) {
    // no file
  }
}

function tryGetPackage(appRoot) {
  try {
    const packagePath = path.join(appRoot, 'package.json');
    const pkg = require(packagePath);
    return pkg;
  } catch (noPackage) {
    // If there is no package.json for the app, well, that's OK
  }
}

function initialize(options) {
  options = options || {};
  const applicationRoot = options.applicationRoot || appRoot;
  const provider = options.provider || painlessConfig;

  let configurationEnvironmentKeyNames = (provider.get('CONFIGURATION_ENVIRONMENT_KEYS') || 'CONFIGURATION_ENVIRONMENT,NODE_ENV').split(',');
  if (!configurationEnvironmentKeyNames || configurationEnvironmentKeyNames.length === 0) {
    throw new Error('No configuration environment key name(s) defined');
  }

  let environment = null;
  for (let i = 0; !environment && i < configurationEnvironmentKeyNames.length; i++) {
    environment = provider.get(configurationEnvironmentKeyNames[i]);
  }
  if (!environment) {
    return provider;
  }

  const providers = [
    provider,
  ];

  if (provider.testConfiguration) {
    providers.push(objectProvider(provider.testConfiguration[environment]));
  } else {
    const appRoot = applicationRoot.toString();

    const environmentDirectoryKey = provider.get('ENVIRONMENT_DIRECTORY_KEY') || 'ENVIRONMENT_DIRECTORY';
    const directoryName = options.directoryName || provider.get(environmentDirectoryKey) || 'env';
    configureLocalEnvironment(providers, appRoot, directoryName, environment);

    const environmentModulesKey = provider.get('ENVIRONMENT_MODULES_KEY') || 'ENVIRONMENT_MODULES';
    const environmentModules = (provider.get(environmentModulesKey) || '').split(',');
    const pkg = tryGetPackage(appRoot);
    let painlessConfigEnvironments = pkg ? pkg.painlessConfigEnvironments : null;
    if (painlessConfigEnvironments) {
      if (Array.isArray(painlessConfigEnvironments)) {
        // This is ready-to-use as-is
      } else if (painlessConfigEnvironments.split) {
        painlessConfigEnvironments = painlessConfigEnvironments.split(',');
      } else {
        throw new Error('Unknown how to process the painlessConfigEnvironments values in package.json');
      }
      environmentModules.push(...painlessConfigEnvironments);
    }
    configurePackageEnvironments(providers, environmentModules, environment);
  }

  return {
    get: function (key) {
      for (let i = 0; i < providers.length; i++) {
        const value = providers[i].get(key);
        if (value !== undefined) {
          return value;
        }
      }
    }
  };
}

initialize.get = function getWithoutInitialize(key) {
  if (!unconfigured) {
    unconfigured = initialize();
  }
  return unconfigured.get(key);
};

module.exports = initialize;
