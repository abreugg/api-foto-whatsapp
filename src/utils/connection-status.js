/** The supplied YAML uses PascalCase; deployed WUZAPI versions also use camelCase. */
export function connectionStatus(value = {}) {
  return {
    Connected: (value.Connected ?? value.connected) === true,
    LoggedIn: (value.LoggedIn ?? value.loggedIn ?? value.logged_in ?? value.loggedin) === true,
  };
}
