export interface IssuedServiceCredential {
  id: string;
  token: string;
  digest: string;
}

export interface ServiceCredentialIssuer {
  issue(): IssuedServiceCredential;
  digest(token: string): string;
}

export interface IssuedMembershipReceipt {
  token: string;
  digest: string;
}

export interface MembershipReceiptIssuer {
  issue(): IssuedMembershipReceipt;
  digest(token: string): string;
}
