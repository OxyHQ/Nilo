import { Link, Stack } from 'expo-router';
import { View, Text } from 'react-native';
import Head from 'expo-router/head';
import { useTranslation } from '@/hooks/useTranslation';

export default function NotFoundScreen() {
  const { t } = useTranslation();
  return (
    <>
      <Head>
        <title>{t('errors.notFound.documentTitle')}</title>
        <meta name="description" content={t('errors.notFound.metaDescription')} />
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <Stack.Screen options={{ title: t('errors.notFound.screenTitle') }} />
      <View className="flex-1 items-center justify-center p-5 bg-background">
        <Text className="text-xl font-bold text-foreground">{t('errors.notFound.message')}</Text>

        <Link href="/" className="mt-4 py-4">
          <Text className="text-sm text-primary">{t('errors.notFound.goHome')}</Text>
        </Link>
      </View>
    </>
  );
}
