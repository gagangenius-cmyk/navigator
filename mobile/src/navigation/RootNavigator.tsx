import { ActivityIndicator, View } from 'react-native';
import { selectStatus, selectUser, useSessionStore } from '@/store/sessionStore';
import { useTheme } from '@/theme/ThemeProvider';
import { AppStack } from './AppStack';
import { AuthStack } from './AuthStack';
import { ForcedPasswordStack } from './ForcedPasswordStack';

/**
 * Chooses what the user can reach at all, from the session alone:
 *   booting                 -> spinner (splash is still up)
 *   signed out              -> login / MFA
 *   mustChangePassword      -> the forced password screen and nothing else
 *   signed in               -> the app (tabs and screens, each RBAC-guarded)
 * Rendering one navigator at a time (rather than hiding screens) means an unauthenticated
 * user has no routes to deep-link into.
 */
export function RootNavigator() {
  const status = useSessionStore(selectStatus);
  const user = useSessionStore(selectUser);
  const { colors } = useTheme();

  if (status === 'booting') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (status === 'signedOut') return <AuthStack />;
  if (user?.mustChangePassword) return <ForcedPasswordStack />;
  return <AppStack />;
}
