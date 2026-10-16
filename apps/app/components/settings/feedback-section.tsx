import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import Constants from 'expo-constants';
import { isAxiosError } from 'axios';
import { Bug, Lightbulb, MessageSquare, Sparkles, Star } from 'lucide-react-native';
import { Button } from '@oxy.so/bloom/button';
import { SettingsSection } from '@oxy.so/bloom/settings-modal/modal';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@/components/ui/text';
import { useTranslation } from '@/hooks/useTranslation';
import apiClient from '@/lib/api/client';
import { useNiloSettings } from './settings-provider';

type FeedbackType = 'bug' | 'feature' | 'improvement' | 'other';

interface FeedbackTypeOption {
  type: FeedbackType;
  labelKey: string;
  icon: React.ElementType;
}

const feedbackTypes: FeedbackTypeOption[] = [
  { type: 'bug', labelKey: 'feedback.bugReport', icon: Bug },
  { type: 'feature', labelKey: 'feedback.featureRequest', icon: Lightbulb },
  { type: 'improvement', labelKey: 'feedback.improvement', icon: Sparkles },
  { type: 'other', labelKey: 'feedback.other', icon: MessageSquare },
];

export function FeedbackSection() {
  const { t } = useTranslation();
  const { close } = useNiloSettings();
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
      close();
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
    <View className="gap-6">
      <SettingsSection label={t('feedback.typeQuestion')} description={t('feedback.subtitle')}>
        <View className="flex-row flex-wrap gap-2">
          {feedbackTypes.map((option) => {
            const Icon = option.icon;
            return (
              <Button
                key={option.type}
                appearance="outline"
                tone="neutral"
                size="sm"
                pressed={selectedType === option.type}
                accessibilityLabel={t(option.labelKey)}
                renderLeadingIcon={({ size, color }) => <Icon size={size} color={color} />}
                onPress={() => setSelectedType(option.type)}
              >
                {t(option.labelKey)}
              </Button>
            );
          })}
        </View>
      </SettingsSection>

      <SettingsSection label={t('feedback.rateExperience')}>
        <View className="flex-row items-center gap-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <Pressable
              key={star}
              accessibilityRole="button"
              accessibilityLabel={ratingLabels[star]}
              accessibilityState={{ selected: rating === star }}
              onPress={() => setRating(rating === star ? null : star)}
              className="p-1.5 active:opacity-70"
            >
              <Star
                size={24}
                className={rating && star <= rating ? 'text-yellow-500' : 'text-muted-foreground'}
                fill={rating && star <= rating ? '#eab308' : 'transparent'}
              />
            </Pressable>
          ))}
          {rating ? (
            <Text className="text-xs text-muted-foreground">{ratingLabels[rating]}</Text>
          ) : null}
        </View>
      </SettingsSection>

      <SettingsSection
        label={t('feedback.yourFeedback')}
        description={t('feedback.characterCount', { count: message.length })}
      >
        <TextFieldInput
          label={t('feedback.yourFeedback')}
          multiline
          placeholder={selectedType ? placeholderMap[selectedType] : t('feedback.otherPlaceholder')}
          value={message}
          onChangeText={setMessage}
          className="min-h-[150px]"
        />
      </SettingsSection>

      <View className="gap-3">
        <Button
          tone="action"
          loading={submitting}
          disabled={!selectedType || !message.trim()}
          onPress={() => {
            void handleSubmit();
          }}
        >
          {t('feedback.submitButton')}
        </Button>
        <Text className="text-xs text-center text-muted-foreground">
          {t('feedback.footerText')}
        </Text>
      </View>
    </View>
  );
}
