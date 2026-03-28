@protocol: 'rest'
@path    : '/api/intake'
@impl    : 'srv/ClaimIntakeService.ts'
service ClaimIntakeService {

  type AttachmentInput {
    filename  : String(255) not null;
    mediaType : String(100) not null;
    content   : LargeBinary not null;
  }

  // Submit a new claim from an external insurer system.
  // At least one of rawText or attachments must be provided.
  // The Structure Agent will extract structured fields; no pre-structured data is expected.
  // Returns the generated claim ID and initial status.
  action submitClaim(
    externalRef  : String(100),
    rawText      : LargeString,
    attachments  : array of AttachmentInput
  ) returns {
    ID     : UUID;
    status : String(20);
  };
}
