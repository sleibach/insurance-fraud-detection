using { fraud as db } from '../db/schema';

@protocol: 'rest'
@path    : '/api/intake'
service ClaimIntakeService {

  type AttachmentInput {
    filename  : String(255) not null;
    mediaType : String(100) not null;
    content   : LargeBinary not null;
  }

  // Submit a new claim from an external insurer system.
  // Returns the generated claim ID and initial status.
  // Auth: add @requires: 'IntakeSystem' before production deployment.
  action submitClaim(
    externalRef  : String(100),
    title        : String(255)   not null,
    description  : String(5000),
    claimAmount  : Decimal(15,2) not null,
    currency     : String(3)     not null,
    claimType    : String(20)    not null,
    attachments  : array of AttachmentInput
  ) returns {
    ID          : UUID;
    externalRef : String(100);
    status      : String(20);
  };
}
