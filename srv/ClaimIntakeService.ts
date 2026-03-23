import cds from '@sap/cds';
import onSubmitClaim from './code/on-submitClaim-logic';

class ClaimIntakeService extends cds.ApplicationService {
  async init(): Promise<void> {
    this.on('submitClaim', onSubmitClaim);
    return super.init();
  }
}

export default ClaimIntakeService;
