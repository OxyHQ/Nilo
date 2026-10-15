import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { openAccountDialog, useOxy } from '@oxy.so/services';
import axios from 'axios';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { FormFields } from '@/components/forms/form-fields';
import { useTranslation } from '@/hooks/useTranslation';
import { usePublicForm, useSubmitForm } from '@/lib/hooks/use-forms';
import { retryAfterSeconds, serializeForm, type FormDraft } from '@/lib/forms';

export default function PublicFormRoute() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <PublicFormPage key={token} token={typeof token === 'string' ? token : ''} />;
}
function PublicFormPage({ token }: { token: string }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, user } = useOxy();
  const query = usePublicForm(token);
  const submit = useSubmitForm(token);
  const submitting = useRef(false);
  const [draft, setDraft] = useState<FormDraft>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [remaining, setRemaining] = useState(0);
  const error = submit.error ?? query.error;
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  useEffect(() => {
    if (axios.isAxiosError(error) && error.response?.status === 429)
      setRemaining(retryAfterSeconds(error.response.headers['retry-after']));
  }, [error]);
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setTimeout(() => setRemaining((n) => Math.max(0, n - 1)), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  useEffect(() => {
    submit.reset();
  }, [isAuthenticated, user?.id, submit.reset]);
  const send = () => {
    if (!query.data || submitting.current || submit.isPending || remaining > 0) return;
    const result = serializeForm(query.data.fields, draft);
    setErrors(result.errors);
    if (Object.keys(result.errors).length === 0) {
      submitting.current = true;
      submit.mutate(result.values, {
        onSettled: () => {
          submitting.current = false;
        },
      });
    }
  };
  const unavailable = !token || status === 404;
  const signIn = status === 401;
  return (
    <ScrollView
      className="flex-1 bg-background"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 }}
      contentContainerClassName="px-6"
    >
      <View className="w-full max-w-xl mx-auto gap-5">
        {submit.isSuccess ? (
          <>
            <Text accessibilityRole="header" className="text-2xl font-semibold">
              {t('databases.form.thanks')}
            </Text>
            <Button
              accessibilityLabel={t('databases.form.another')}
              onPress={() => {
                setDraft({});
                setErrors({});
                submit.reset();
              }}
            >
              <Text>{t('databases.form.another')}</Text>
            </Button>
          </>
        ) : unavailable ? (
          <Text accessibilityRole="header" className="text-xl font-semibold">
            {t('databases.form.unavailable')}
          </Text>
        ) : signIn ? (
          <>
            <Text>{t('databases.form.signInRequired')}</Text>
            <Button
              accessibilityLabel={t('login.signInButton')}
              onPress={() => openAccountDialog()}
            >
              <Text>{t('login.signInButton')}</Text>
            </Button>
          </>
        ) : query.isPending ? (
          <ActivityIndicator />
        ) : (
          <>
            {query.data ? (
              <>
                <Text accessibilityRole="header" className="text-3xl font-bold">
                  {query.data.title}
                </Text>
                {query.data.description ? (
                  <Text className="text-muted-foreground">{query.data.description}</Text>
                ) : null}
                <FormFields
                  fields={query.data.fields}
                  draft={draft}
                  onChange={setDraft}
                  errors={errors}
                  disabled={submit.isPending}
                />
                <Button
                  accessibilityLabel={t('databases.form.submit')}
                  disabled={submit.isPending || remaining > 0}
                  onPress={send}
                >
                  <Text>
                    {t(submit.isPending ? 'databases.form.submitting' : 'databases.form.submit')}
                  </Text>
                </Button>
              </>
            ) : null}
            {error ? (
              <Text accessibilityRole="alert" className="text-destructive">
                {status === 429
                  ? t('databases.form.rateLimited', { seconds: remaining })
                  : t(
                      status === 400
                        ? 'databases.form.invalidResponse'
                        : 'databases.form.loadFailed',
                    )}
              </Text>
            ) : null}
            {!query.data ? (
              <Button
                variant="outline"
                disabled={remaining > 0 || query.isFetching}
                accessibilityLabel={t('databases.form.retry')}
                onPress={() => void query.refetch()}
              >
                <Text>{t('databases.form.retry')}</Text>
              </Button>
            ) : null}
          </>
        )}
      </View>
    </ScrollView>
  );
}
