import { gql } from "urql";

export const USER_KEYS_QUERY = gql`
  query { userKeys { publicKey encryptedPrivateKey keySalt } }
`;

export const ORG_KEYS_QUERY = gql`
  query { orgKeys { orgPublicKey encryptedOrgPrivateKey isPersonalOrg } }
`;
