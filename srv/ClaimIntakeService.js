'use strict';
const cds = require('@sap/cds');

class ClaimIntakeService extends cds.ApplicationService {
  async init() {
    const submitClaim = require('./code/on-submitClaim-logic');
    this.on('submitClaim', submitClaim);
    return super.init();
  }
}

module.exports = ClaimIntakeService;
