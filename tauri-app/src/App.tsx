import { SettingsScreen } from "./screens/SettingsScreen";

function App() {
  // Settings is the first vertical slice (data layer, Jira token handling,
  // styling approach) -- other screens (Calendar, Templates, Summary) come
  // once this proves out.
  return <SettingsScreen />;
}

export default App;
