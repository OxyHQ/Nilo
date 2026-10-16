import { View, Platform } from 'react-native';
import { KeyboardAwareScrollView } from '@/lib/keyboard';
import { Button } from '@oxy.so/bloom/button';
import { RadioGroup } from '@oxy.so/bloom/radio';
import { Textarea } from '@oxy.so/bloom/textarea';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text } from '@oxy.so/bloom/typography';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import apiClient from '@/lib/api/client';
import Constants from 'expo-constants';
import { isAxiosError } from 'axios';
import { MessageSquare, Bug, Lightbulb, Sparkles, Star } from 'lucide-react-native';
import { SettingsHeader } from '@/components/settings/settings-header';
import { toast } from '@oxy.so/bloom/toast';
import { useTranslation } from '@/hooks/useTranslation';

type FeedbackType = 'bug' | 'feature' | 'improvement' | 'other';

interface FeedbackTypeOption {
  type: FeedbackType;
  labelKey: string;
  descriptionKey: string;
  icon: React.ElementType;
}

const feedbackTypes: FeedbackTypeOption[] = [
  {
    type: 'bug',
    labelKey: 'feedback.bugReport',
    descriptionKey: 'feedback.bugDescription',
    icon: Bug,
  },
  {
    type: 'feature',
    labelKey: 'feedback.featureRequest',
    descriptionKey: 'feedback.featureDescription',
    icon: Lightbulb,
  },
  {
    type: 'improvement',
    labelKey: 'feedback.improvement',
    descriptionKey: 'feedback.improvementDescription',
    icon: Sparkles,
  },
  {
    type: 'other',
    labelKey: 'feedback.other',
    descriptionKey: 'feedback.otherDescription',
    icon: MessageSquare,
  },
];

export default function FeedbackScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const [selectedType, setSelectedType] = useState<FeedbackType | null>(null);
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!selectedType) {
      toast.error(t('feedback.selectType'));
      return;
    }

    if (!message.trim()) {
      toast.error(t('feedback.enterMessage'));
      return;
    }

    if (message.trim().length < 10) {
      toast.error(t('feedback.moreDetails'));
      return;
    }

    try {
      setSubmitting(true);

      await apiClient.post('/feedback', {
        type: selectedType,
        message: message.trim(),
        // Rating is optional; an unrated report sends none.
        ...(rating !== null && { rating }),
        metadata: {
          platform: Platform.OS,
          appVersion: Constants.expoConfig?.version ?? 'unknown',
        },
      });
      toast.success(t('feedback.thankYou'));
      setSelectedType(null);
      setMessage('');
      setRating(null);
      router.back();
    } catch (error: unknown) {
      const serverMessage = isAxiosError<{ error?: string }>(error)
        ? error.response?.data?.error
        : undefined;
      toast.error(serverMessage || t('feedback.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const ratingLabels: Record<number, string> = {
    1: t('feedback.veryPoor'),
    2: t('feedback.poor'),
    3: t('feedback.average'),
    4: t('feedback.good'),
    5: t('feedback.excellent'),
  };

  const placeholderMap: Record<FeedbackType, string> = {
    bug: t('feedback.bugPlaceholder'),
    feature: t('feedback.featurePlaceholder'),
    improvement: t('feedback.improvementPlaceholder'),
    other: t('feedback.otherPlaceholder'),
  };

  return (
    <View className="flex-1 bg-background">
      <SettingsHeader title={t('feedback.title')} subtitle={t('feedback.subtitle')} showBack />

      <KeyboardAwareScrollView bottomOffset={20} className="flex-1 p-5">
        <View className="max-w-2xl mx-auto w-full gap-6">
          {/* Feedback Type Selection */}
          <View className="gap-3">
            <Text className="text-[11px] font-semibold text-muted-foreground tracking-wider uppercase">
              {t('feedback.typeQuestion')}
            </Text>
            <RadioGroup
              variant="card"
              label={t('feedback.typeQuestion')}
              value={selectedType ?? undefined}
              onValueChange={(value) => setSelectedType(value as FeedbackType)}
              options={feedbackTypes.map((option) => {
                const Icon = option.icon;
                return {
                  value: option.type,
                  label: t(option.labelKey),
                  description: t(option.descriptionKey),
                  labelContent: (
                    <View className="flex-row items-center gap-3">
                      <View className="p-2 rounded-full bg-muted">
                        <Icon size={20} color={colors.textSecondary} />
                      </View>
                      <View className="flex-1">
                        <Text variant="body-medium">{t(option.labelKey)}</Text>
                        <Text className="text-xs text-muted-foreground">
                          {t(option.descriptionKey)}
                        </Text>
                      </View>
                    </View>
                  ),
                };
              })}
            />
          </View>

          {/* Rating (Optional) */}
          <View className="gap-3">
            <Text className="text-[11px] font-semibold text-muted-foreground tracking-wider uppercase">
              {t('feedback.rateExperience')}
            </Text>
            <View className="flex-row gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <Button
                  key={star}
                  appearance="plain"
                  size="lg"
                  iconOnly
                  pressed={rating === star}
                  accessibilityLabel={ratingLabels[star]}
                  onPress={() => setRating(rating === star ? null : star)}
                  icon={
                    <Star
                      size={24}
                      color={rating && star <= rating ? colors.warning : colors.textSecondary}
                      fill={rating && star <= rating ? colors.warning : 'transparent'}
                    />
                  }
                />
              ))}
            </View>
            {rating && (
              <Text className="text-xs text-muted-foreground">{ratingLabels[rating]}</Text>
            )}
          </View>

          {/* Message */}
          <View className="gap-3">
            <Text className="text-[11px] font-semibold text-muted-foreground tracking-wider uppercase">
              {t('feedback.yourFeedback')}
            </Text>
            <Textarea
              accessibilityLabel={t('feedback.yourFeedback')}
              placeholder={
                selectedType ? placeholderMap[selectedType] : t('feedback.otherPlaceholder')
              }
              value={message}
              onChangeText={setMessage}
              rows={6}
            />
            <Text className="text-xs text-muted-foreground">
              {t('feedback.characterCount', { count: message.length })}
            </Text>
          </View>

          {/* Submit Button */}
          <View className="gap-4 pt-2">
            <Button
              appearance="solid"
              tone="accent"
              onPress={handleSubmit}
              disabled={submitting || !selectedType || !message.trim()}
              loading={submitting}
            >
              {t('feedback.submitButton')}
            </Button>

            <Text className="text-xs text-center text-muted-foreground">
              {t('feedback.footerText')}
            </Text>
          </View>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}
