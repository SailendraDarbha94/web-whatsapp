/**
 * Firebase Auth custom claim that marks an account as an inbox operator.
 * Granted with `npm run operators -- grant <email>`; required by
 * firestore.rules and by every /api/whatsapp route operators call.
 */
export const OPERATOR_CLAIM = "operator";
