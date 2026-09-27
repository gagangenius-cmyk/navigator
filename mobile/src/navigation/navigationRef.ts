import { createNavigationContainerRef } from '@react-navigation/native';
import type { AppStackParamList } from './types';

// Lets code outside a component (the push bridge, deep-link handlers) navigate.
export const navigationRef = createNavigationContainerRef<AppStackParamList>();
