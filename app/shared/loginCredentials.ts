/** Read native form values, including autofill that has not emitted input events.
 * Passwords are used for this request only; never persisted by this helper.
 */
export function loginCredentials(form: HTMLFormElement): Readonly<{ email: string; password: string }> {
  const data = new FormData(form);
  const username = data.get("username"), password = data.get("password");
  return { email: typeof username === "string" ? username : "", password: typeof password === "string" ? password : "" };
}
