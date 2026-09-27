import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ChangePasswordScreen } from '@/features/auth/screens/ChangePasswordScreen';
import type { ForcedPasswordParamList } from './types';

const Stack = createNativeStackNavigator<ForcedPasswordParamList>();

/** The only reachable screen while `mustChangePassword` is set. */
export function ForcedPasswordStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ForcedPassword">{() => <ChangePasswordScreen forced />}</Stack.Screen>
    </Stack.Navigator>
  );
}
