import { View, Text, StyleSheet, ScrollView } from 'react-native';
import type { DrawerScreenProps } from '@react-navigation/drawer';
import { useTranslation } from 'react-i18next';
import { Screen } from '../../components/ui/Screen';
import { ScreenEnter } from '../../components/ui/ScreenEnter';
import { BlackHeader } from '../../components/ui/BlackHeader';
import { openDrawer } from '../../utils/nav';
import type { RootDrawerParamList } from '../../navigation/paramList';
import {
  TERMS_TITLE,
  TERMS_SECTIONS,
  TERMS_LAST_UPDATED,
} from '../../content/legal/termsOfUse.he';
import {
  TERMS_TITLE_AR,
  TERMS_SECTIONS_AR,
  TERMS_LAST_UPDATED_AR,
} from '../../content/legal/termsOfUse.ar';
import {
  PRIVACY_TITLE,
  PRIVACY_SECTIONS,
  PRIVACY_LAST_UPDATED,
} from '../../content/legal/privacyPolicy.he';
import {
  PRIVACY_TITLE_AR,
  PRIVACY_SECTIONS_AR,
  PRIVACY_LAST_UPDATED_AR,
} from '../../content/legal/privacyPolicy.ar';
import {
  ACCESSIBILITY_TITLE,
  ACCESSIBILITY_SECTIONS,
  ACCESSIBILITY_LAST_UPDATED,
} from '../../content/legal/accessibilityStatement.he';
import {
  ACCESSIBILITY_TITLE_AR,
  ACCESSIBILITY_SECTIONS_AR,
  ACCESSIBILITY_LAST_UPDATED_AR,
} from '../../content/legal/accessibilityStatement.ar';
import { useAppLocale } from '../../contexts/LocaleContext';
import { colors, spacing, radius, presets, textStyles, shadows } from '../../theme';

export type LegalDocumentParams = RootDrawerParamList['LegalDocument'];

type Props = DrawerScreenProps<RootDrawerParamList, 'LegalDocument'>;

export function LegalDocumentScreen({ navigation, route }: Props) {
  const { document, returnTo } = route.params;
  const { t } = useTranslation();
  const { locale } = useAppLocale();

  const isAr = locale === 'ar';
  const documents = {
    terms: {
      title: isAr ? TERMS_TITLE_AR : TERMS_TITLE,
      sections: isAr ? TERMS_SECTIONS_AR : TERMS_SECTIONS,
      updated: isAr ? TERMS_LAST_UPDATED_AR : TERMS_LAST_UPDATED,
    },
    privacy: {
      title: isAr ? PRIVACY_TITLE_AR : PRIVACY_TITLE,
      sections: isAr ? PRIVACY_SECTIONS_AR : PRIVACY_SECTIONS,
      updated: isAr ? PRIVACY_LAST_UPDATED_AR : PRIVACY_LAST_UPDATED,
    },
    accessibility: {
      title: isAr ? ACCESSIBILITY_TITLE_AR : ACCESSIBILITY_TITLE,
      sections: isAr ? ACCESSIBILITY_SECTIONS_AR : ACCESSIBILITY_SECTIONS,
      updated: isAr ? ACCESSIBILITY_LAST_UPDATED_AR : ACCESSIBILITY_LAST_UPDATED,
    },
  } as const;
  const { title, sections, updated } = documents[document];

  return (
    <Screen style={styles.wrapper} noPadding>
      <BlackHeader
        title={title}
        onBackPress={() => navigation.navigate(returnTo)}
        onMenuPress={() => openDrawer(navigation)}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <ScreenEnter replayOnFocus variant="rise" style={{ flexGrow: 1 }}>
        <View style={styles.metaCard}>
          <Text style={styles.metaText}>{t('legal.lastUpdated', { date: updated })}</Text>
        </View>
        <View style={styles.bodyCard}>
          {sections.map((block, index) => (
            <View key={index} style={styles.block}>
              <Text style={styles.blockTitle}>{block.title}</Text>
              {block.body.split('\n\n').map((para, pi) => (
                <Text key={pi} style={styles.blockBody}>
                  {para.trim()}
                </Text>
              ))}
            </View>
          ))}
        </View>
        </ScreenEnter>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  scrollContent: {
    ...presets.scrollContent,
    paddingTop: spacing.md,
  },
  metaCard: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metaText: {
    ...textStyles.caption,
    textAlign: 'center',
    color: colors.textSecondary,
  },
  bodyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.card,
  },
  block: { marginBottom: spacing.lg },
  blockTitle: {
    ...textStyles.sectionTitle,
    marginBottom: spacing.sm,
    textAlign: 'right',
  },
  blockBody: {
    ...textStyles.body,
    lineHeight: 24,
    marginBottom: spacing.sm,
    textAlign: 'right',
  },
});
