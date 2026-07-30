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
    plugins: [...(config.plugins ?? []), '@react-native-community/datetimepicker', 'expo-notifications'],
    extra: {
      ...(config.extra ?? {}),
      apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
      eas: {
        ...((config.extra as { eas?: Record<string, unknown> } | undefined)?.eas ?? {}),
        projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? '',
      },
    },
  }) as ExpoConfig;
