#!/usr/bin/env node
// Prints the Environment and ServiceName tag values, tab-separated, for
// scripts that find a deployed environment's stacks by those tags
import {
  getEnvironment,
  serviceMetadata,
} from '../src/constants/environment.ts';

console.log(`${getEnvironment()}\t${serviceMetadata.serviceName}`);
