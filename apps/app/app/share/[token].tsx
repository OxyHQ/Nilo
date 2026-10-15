import React from "react";
import {
  View,
  ScrollView,
  Pressable,
  Platform,
  Linking,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import axios from "axios";
import { Text } from "@/components/ui/text";
import { NiloWordmark } from "@/components/ui/nilo-wordmark";
import { useColorScheme } from "@/lib/useColorScheme";
import { useTranslation } from "@/hooks/useTranslation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useSharedPage,
  type SharedPage,
} from "@/lib/hooks/use-share-links";
import { SharedBlockRenderer } from "@/components/sharing/shared-block-renderer";

interface ShareLoadStateProps {
  title: string;
  body: string;
}

function ShareLoadState({ title, body }: ShareLoadStateProps) {
  return (
    <View className="flex-1 items-center justify-center px-6 gap-3">
      <Text className="text-xl font-semibold text-foreground text-center">
        {title}
      </Text>
      <Text className="text-sm text-muted-foreground text-center max-w-md">
        {body}
      </Text>
    </View>
  );
}

function ShareFooter() {
  const { t } = useTranslation();
  const handlePress = React.useCallback(() => {
    const url = "https://nilo.so";
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") {
        window.open(url, "_blank", "noopener");
      }
      return;
    }
    Linking.openURL(url).catch(() => {
      /* user-driven, ignore failure */
    });
  }, []);

  return (
    <Pressable
      onPress={handlePress}
      className="flex-row items-center justify-center gap-2 py-4"
      accessibilityRole="link"
      accessibilityLabel={t("pages.share.madeWithNilo")}
    >
      <Text className="text-xs text-muted-foreground">{t("pages.share.madeWith")}</Text>
      <NiloWordmark width={70} />
    </Pressable>
  );
}

export default function PublicSharePage() {
  const insets = useSafeAreaInsets();
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ token: string }>();
  const token = typeof params.token === "string" ? params.token : null;

  const { data, isLoading, isError, error } = useSharedPage(token);

  if (!token) {
    return (
      <View
        className="flex-1 bg-background"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <ShareLoadState
          title={t("pages.share.invalidTitle")}
          body={t("pages.share.invalidBody")}
        />
        <ShareFooter />
      </View>
    );
  }

  if (isLoading) {
    return (
      <View
        className="flex-1 bg-background items-center justify-center"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <ActivityIndicator color={colors.foreground} />
      </View>
    );
  }

  if (isError || !data) {
    const status = axios.isAxiosError(error) ? error.response?.status : null;
    let title = t("pages.share.unavailableTitle");
    let body = t("pages.share.unavailableBody");
    if (status === 404) {
      title = t("pages.share.notFoundTitle");
      body = t("pages.share.notFoundBody");
    } else if (status === 410) {
      title = t("pages.share.expiredTitle");
      body = t("pages.share.expiredBody");
    } else if (error instanceof Error && error.message) {
      body = error.message;
    }
    return (
      <View
        className="flex-1 bg-background"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <ShareLoadState title={title} body={body} />
        <ShareFooter />
      </View>
    );
  }

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 py-8 sm:px-8 sm:py-12 md:px-12"
      >
        <View className="w-full max-w-3xl mx-auto gap-4">
          <SharedPageHeader page={data.page} />
          <View className="gap-1.5">
            {data.blocks.length === 0 ? (
              <Text className="text-sm text-muted-foreground">
                {t("pages.share.empty")}
              </Text>
            ) : (
              data.blocks.map((block) => (
                <SharedBlockRenderer key={block._id} block={block} />
              ))
            )}
          </View>
        </View>
      </ScrollView>
      <ShareFooter />
    </View>
  );
}

function SharedPageHeader({ page }: { page: SharedPage["page"] }) {
  const { t } = useTranslation();
  return (
    <View className="gap-2">
      {page.icon ? (
        <Text className="text-4xl" style={{ lineHeight: 48 }}>
          {page.icon}
        </Text>
      ) : null}
      <Text className="text-3xl font-bold text-foreground sm:text-4xl">
        {page.title?.trim() ? page.title : t("pages.untitled")}
      </Text>
    </View>
  );
}
