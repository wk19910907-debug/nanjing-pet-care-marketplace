type PasswordChangeSession = { mustChangePassword?: boolean };

/** Allows staff identity checks while keeping unfinished password-change sessions out of all work routes. */
export async function authenticateStaffAction<T extends PasswordChangeSession>(
  authenticate: (authorizationHeader: string | undefined) => Promise<T>,
  authorizationHeader: string | undefined,
): Promise<T> {
  const actor = await authenticate(authorizationHeader);
  if (actor.mustChangePassword === true) throw new Error('PASSWORD_CHANGE_REQUIRED');
  return actor;
}
