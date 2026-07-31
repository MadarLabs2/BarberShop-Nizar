import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

const rootEnv = path.resolve(__dirname, '..', '..', '.env');
if (fs.existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv, quiet: true });
}

export default ({ config }: ConfigContext): ExpoConfig =>
  ({
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      '@react-native-community/datetimepicker',
      'expo-notifications',
      'expo-font',
      'expo-image',
      'expo-secure-store',
      'expo-sharing',
      [
        'expo-splash-screen',
        {
          image: './assets/splash.png',
          resizeMode: 'contain',
          backgroundColor: '#ffffff',
        },
      ],
      'expo-status-bar',
    ],
    extra: {
      ...(config.extra ?? {}),
      apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
      eas: {
        ...((config.extra as { eas?: Record<string, unknown> } | undefined)?.eas ?? {}),
        projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? '',
      },
    },
  }) as ExpoConfig;
