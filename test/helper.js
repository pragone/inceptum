require('../src/util/PatchCoroutine');
require('must');

const mocha = require('mocha');
const coMocha = require('co-mocha');

coMocha(mocha);
