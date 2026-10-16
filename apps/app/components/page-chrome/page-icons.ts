/**
 * Curated Bloom (Remix) icons for the page icon picker.
 *
 * Each icon is imported by its own subpath, because the whole set through one
 * barrel blows the Metro bundle. We pick a focused set that covers most
 * page-icon needs (docs, projects, areas, common subjects) and let users fall
 * back to emoji for anything missing.
 *
 * `name` is stored in pages and predates the move from lucide, so it keeps
 * lucide's vocabulary; a few subjects Remix has no glyph for (cat, dog, fish,
 * pizza, …) draw the nearest one.
 */

import { RiPulseLine } from '@oxy.so/bloom/icons/RiPulseLine';
import { RiAirplayLine } from '@oxy.so/bloom/icons/RiAirplayLine';
import { RiAlarmLine } from '@oxy.so/bloom/icons/RiAlarmLine';
import { RiAlbumLine } from '@oxy.so/bloom/icons/RiAlbumLine';
import { RiErrorWarningLine } from '@oxy.so/bloom/icons/RiErrorWarningLine';
import { RiAlertLine } from '@oxy.so/bloom/icons/RiAlertLine';
import { RiAnchorLine } from '@oxy.so/bloom/icons/RiAnchorLine';
import { RiCameraLensLine } from '@oxy.so/bloom/icons/RiCameraLensLine';
import { RiArchiveLine } from '@oxy.so/bloom/icons/RiArchiveLine';
import { RiAwardLine } from '@oxy.so/bloom/icons/RiAwardLine';
import { RiHandbagLine } from '@oxy.so/bloom/icons/RiHandbagLine';
import { RiMoneyDollarBoxLine } from '@oxy.so/bloom/icons/RiMoneyDollarBoxLine';
import { RiBarChartLine } from '@oxy.so/bloom/icons/RiBarChartLine';
import { RiBatteryLine } from '@oxy.so/bloom/icons/RiBatteryLine';
import { RiFlaskLine } from '@oxy.so/bloom/icons/RiFlaskLine';
import { RiNotification3Line } from '@oxy.so/bloom/icons/RiNotification3Line';
import { RiBikeLine } from '@oxy.so/bloom/icons/RiBikeLine';
import { RiQuillPenLine } from '@oxy.so/bloom/icons/RiQuillPenLine';
import { RiBtcLine } from '@oxy.so/bloom/icons/RiBtcLine';
import { RiBluetoothLine } from '@oxy.so/bloom/icons/RiBluetoothLine';
import { RiFlashlightLine } from '@oxy.so/bloom/icons/RiFlashlightLine';
import { RiBookLine } from '@oxy.so/bloom/icons/RiBookLine';
import { RiBookOpenLine } from '@oxy.so/bloom/icons/RiBookOpenLine';
import { RiBookmarkLine } from '@oxy.so/bloom/icons/RiBookmarkLine';
import { RiBox3Line } from '@oxy.so/bloom/icons/RiBox3Line';
import { RiBriefcase4Line } from '@oxy.so/bloom/icons/RiBriefcase4Line';
import { RiBrushLine } from '@oxy.so/bloom/icons/RiBrushLine';
import { RiBugLine } from '@oxy.so/bloom/icons/RiBugLine';
import { RiBuildingLine } from '@oxy.so/bloom/icons/RiBuildingLine';
import { RiBusLine } from '@oxy.so/bloom/icons/RiBusLine';
import { RiCake2Line } from '@oxy.so/bloom/icons/RiCake2Line';
import { RiCalculatorLine } from '@oxy.so/bloom/icons/RiCalculatorLine';
import { RiCalendarLine } from '@oxy.so/bloom/icons/RiCalendarLine';
import { RiCameraLine } from '@oxy.so/bloom/icons/RiCameraLine';
import { RiCarLine } from '@oxy.so/bloom/icons/RiCarLine';
import { RiBearSmileLine } from '@oxy.so/bloom/icons/RiBearSmileLine';
import { RiBarChartBoxLine } from '@oxy.so/bloom/icons/RiBarChartBoxLine';
import { RiLineChartLine } from '@oxy.so/bloom/icons/RiLineChartLine';
import { RiPieChartLine } from '@oxy.so/bloom/icons/RiPieChartLine';
import { RiCheckLine } from '@oxy.so/bloom/icons/RiCheckLine';
import { RiCheckboxLine } from '@oxy.so/bloom/icons/RiCheckboxLine';
import { RiAppleLine } from '@oxy.so/bloom/icons/RiAppleLine';
import { RiQuestionLine } from '@oxy.so/bloom/icons/RiQuestionLine';
import { RiClipboardLine } from '@oxy.so/bloom/icons/RiClipboardLine';
import { RiTimeLine } from '@oxy.so/bloom/icons/RiTimeLine';
import { RiCloudLine } from '@oxy.so/bloom/icons/RiCloudLine';
import { RiCupLine } from '@oxy.so/bloom/icons/RiCupLine';
import { RiCoinsLine } from '@oxy.so/bloom/icons/RiCoinsLine';
import { RiCompass3Line } from '@oxy.so/bloom/icons/RiCompass3Line';
import { RiTrafficLightLine } from '@oxy.so/bloom/icons/RiTrafficLightLine';
import { RiCookieLine } from '@oxy.so/bloom/icons/RiCookieLine';
import { RiCpuLine } from '@oxy.so/bloom/icons/RiCpuLine';
import { RiBankCardLine } from '@oxy.so/bloom/icons/RiBankCardLine';
import { RiVipCrownLine } from '@oxy.so/bloom/icons/RiVipCrownLine';
import { RiDrinks2Line } from '@oxy.so/bloom/icons/RiDrinks2Line';
import { RiDatabase2Line } from '@oxy.so/bloom/icons/RiDatabase2Line';
import { RiVipDiamondLine } from '@oxy.so/bloom/icons/RiVipDiamondLine';
import { RiDownload2Line } from '@oxy.so/bloom/icons/RiDownload2Line';
import { RiDropLine } from '@oxy.so/bloom/icons/RiDropLine';
import { RiDiscLine } from '@oxy.so/bloom/icons/RiDiscLine';
import { RiBoxingLine } from '@oxy.so/bloom/icons/RiBoxingLine';
import { RiEarthLine } from '@oxy.so/bloom/icons/RiEarthLine';
import { RiBowlLine } from '@oxy.so/bloom/icons/RiBowlLine';
import { RiFileLine } from '@oxy.so/bloom/icons/RiFileLine';
import { RiFileTextLine } from '@oxy.so/bloom/icons/RiFileTextLine';
import { RiFilmLine } from '@oxy.so/bloom/icons/RiFilmLine';
import { RiFilter3Line } from '@oxy.so/bloom/icons/RiFilter3Line';
import { RiSailboatLine } from '@oxy.so/bloom/icons/RiSailboatLine';
import { RiFlagLine } from '@oxy.so/bloom/icons/RiFlagLine';
import { RiFireLine } from '@oxy.so/bloom/icons/RiFireLine';
import { RiFlowerLine } from '@oxy.so/bloom/icons/RiFlowerLine';
import { RiFolderLine } from '@oxy.so/bloom/icons/RiFolderLine';
import { RiFootprintLine } from '@oxy.so/bloom/icons/RiFootprintLine';
import { RiGamepadLine } from '@oxy.so/bloom/icons/RiGamepadLine';
import { RiDashboard3Line } from '@oxy.so/bloom/icons/RiDashboard3Line';
import { RiGiftLine } from '@oxy.so/bloom/icons/RiGiftLine';
import { RiGlobalLine } from '@oxy.so/bloom/icons/RiGlobalLine';
import { RiGraduationCapLine } from '@oxy.so/bloom/icons/RiGraduationCapLine';
import { RiPlantLine } from '@oxy.so/bloom/icons/RiPlantLine';
import { RiLayoutGridLine } from '@oxy.so/bloom/icons/RiLayoutGridLine';
import { RiHammerLine } from '@oxy.so/bloom/icons/RiHammerLine';
import { RiHand } from '@oxy.so/bloom/icons/RiHand';
import { RiHardDrive2Line } from '@oxy.so/bloom/icons/RiHardDrive2Line';
import { RiHashtag } from '@oxy.so/bloom/icons/RiHashtag';
import { RiHeadphoneLine } from '@oxy.so/bloom/icons/RiHeadphoneLine';
import { RiHeart3Line } from '@oxy.so/bloom/icons/RiHeart3Line';
import { RiMarkPenLine } from '@oxy.so/bloom/icons/RiMarkPenLine';
import { RiHome5Line } from '@oxy.so/bloom/icons/RiHome5Line';
import { RiCake3Line } from '@oxy.so/bloom/icons/RiCake3Line';
import { RiInbox2Line } from '@oxy.so/bloom/icons/RiInbox2Line';
import { RiInfinityLine } from '@oxy.so/bloom/icons/RiInfinityLine';
import { RiInformationLine } from '@oxy.so/bloom/icons/RiInformationLine';
import { RiKey2Line } from '@oxy.so/bloom/icons/RiKey2Line';
import { RiKeyboardLine } from '@oxy.so/bloom/icons/RiKeyboardLine';
import { RiLightbulbLine } from '@oxy.so/bloom/icons/RiLightbulbLine';
import { RiMacbookLine } from '@oxy.so/bloom/icons/RiMacbookLine';
import { RiLeafLine } from '@oxy.so/bloom/icons/RiLeafLine';
import { RiBookShelfLine } from '@oxy.so/bloom/icons/RiBookShelfLine';
import { RiLifebuoyLine } from '@oxy.so/bloom/icons/RiLifebuoyLine';
import { RiLink } from '@oxy.so/bloom/icons/RiLink';
import { RiLockLine } from '@oxy.so/bloom/icons/RiLockLine';
import { RiLoginBoxLine } from '@oxy.so/bloom/icons/RiLoginBoxLine';
import { RiMailLine } from '@oxy.so/bloom/icons/RiMailLine';
import { RiMap2Line } from '@oxy.so/bloom/icons/RiMap2Line';
import { RiMapPinLine } from '@oxy.so/bloom/icons/RiMapPinLine';
import { RiMedalLine } from '@oxy.so/bloom/icons/RiMedalLine';
import { RiMegaphoneLine } from '@oxy.so/bloom/icons/RiMegaphoneLine';
import { RiChat3Line } from '@oxy.so/bloom/icons/RiChat3Line';
import { RiMicLine } from '@oxy.so/bloom/icons/RiMicLine';
import { RiComputerLine } from '@oxy.so/bloom/icons/RiComputerLine';
import { RiMoonLine } from '@oxy.so/bloom/icons/RiMoonLine';
import { RiLandscapeLine } from '@oxy.so/bloom/icons/RiLandscapeLine';
import { RiMouseLine } from '@oxy.so/bloom/icons/RiMouseLine';
import { RiMusic2Line } from '@oxy.so/bloom/icons/RiMusic2Line';
import { RiNewspaperLine } from '@oxy.so/bloom/icons/RiNewspaperLine';
import { RiBookletLine } from '@oxy.so/bloom/icons/RiBookletLine';
import { RiPaletteLine } from '@oxy.so/bloom/icons/RiPaletteLine';
import { RiSideBarLine } from '@oxy.so/bloom/icons/RiSideBarLine';
import { RiAttachment2 } from '@oxy.so/bloom/icons/RiAttachment2';
import { RiPauseLine } from '@oxy.so/bloom/icons/RiPauseLine';
import { RiPenNibLine } from '@oxy.so/bloom/icons/RiPenNibLine';
import { RiPencilLine } from '@oxy.so/bloom/icons/RiPencilLine';
import { RiPhoneLine } from '@oxy.so/bloom/icons/RiPhoneLine';
import { RiRestaurantLine } from '@oxy.so/bloom/icons/RiRestaurantLine';
import { RiPlaneLine } from '@oxy.so/bloom/icons/RiPlaneLine';
import { RiPlayLine } from '@oxy.so/bloom/icons/RiPlayLine';
import { RiPlugLine } from '@oxy.so/bloom/icons/RiPlugLine';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { RiPrinterLine } from '@oxy.so/bloom/icons/RiPrinterLine';
import { RiPuzzleLine } from '@oxy.so/bloom/icons/RiPuzzleLine';
import { RiDoubleQuotesL } from '@oxy.so/bloom/icons/RiDoubleQuotesL';
import { RiRadioLine } from '@oxy.so/bloom/icons/RiRadioLine';
import { RiRainbowLine } from '@oxy.so/bloom/icons/RiRainbowLine';
import { RiReceiptLine } from '@oxy.so/bloom/icons/RiReceiptLine';
import { RiRecycleLine } from '@oxy.so/bloom/icons/RiRecycleLine';
import { RiRocket2Line } from '@oxy.so/bloom/icons/RiRocket2Line';
import { RiSaveLine } from '@oxy.so/bloom/icons/RiSaveLine';
import { RiScissorsLine } from '@oxy.so/bloom/icons/RiScissorsLine';
import { RiSearchLine } from '@oxy.so/bloom/icons/RiSearchLine';
import { RiSendPlaneLine } from '@oxy.so/bloom/icons/RiSendPlaneLine';
import { RiServerLine } from '@oxy.so/bloom/icons/RiServerLine';
import { RiSettings3Line } from '@oxy.so/bloom/icons/RiSettings3Line';
import { RiShareBoxLine } from '@oxy.so/bloom/icons/RiShareBoxLine';
import { RiShieldLine } from '@oxy.so/bloom/icons/RiShieldLine';
import { RiShip2Line } from '@oxy.so/bloom/icons/RiShip2Line';
import { RiShoppingBag3Line } from '@oxy.so/bloom/icons/RiShoppingBag3Line';
import { RiShoppingCartLine } from '@oxy.so/bloom/icons/RiShoppingCartLine';
import { RiEmotionHappyLine } from '@oxy.so/bloom/icons/RiEmotionHappyLine';
import { RiSnowflakeLine } from '@oxy.so/bloom/icons/RiSnowflakeLine';
import { RiSparklingLine } from '@oxy.so/bloom/icons/RiSparklingLine';
import { RiSpeakerLine } from '@oxy.so/bloom/icons/RiSpeakerLine';
import { RiStarLine } from '@oxy.so/bloom/icons/RiStarLine';
import { RiSunLine } from '@oxy.so/bloom/icons/RiSunLine';
import { RiSwordLine } from '@oxy.so/bloom/icons/RiSwordLine';
import { RiPriceTag3Line } from '@oxy.so/bloom/icons/RiPriceTag3Line';
import { RiFocus3Line } from '@oxy.so/bloom/icons/RiFocus3Line';
import { RiTerminalBoxLine } from '@oxy.so/bloom/icons/RiTerminalBoxLine';
import { RiTempHotLine } from '@oxy.so/bloom/icons/RiTempHotLine';
import { RiThumbUpLine } from '@oxy.so/bloom/icons/RiThumbUpLine';
import { RiTicketLine } from '@oxy.so/bloom/icons/RiTicketLine';
import { RiTimerLine } from '@oxy.so/bloom/icons/RiTimerLine';
import { RiTrainLine } from '@oxy.so/bloom/icons/RiTrainLine';
import { RiDeleteBinLine } from '@oxy.so/bloom/icons/RiDeleteBinLine';
import { RiTreeLine } from '@oxy.so/bloom/icons/RiTreeLine';
import { RiStockLine } from '@oxy.so/bloom/icons/RiStockLine';
import { RiTrophyLine } from '@oxy.so/bloom/icons/RiTrophyLine';
import { RiTruckLine } from '@oxy.so/bloom/icons/RiTruckLine';
import { RiTvLine } from '@oxy.so/bloom/icons/RiTvLine';
import { RiUmbrellaLine } from '@oxy.so/bloom/icons/RiUmbrellaLine';
import { RiUpload2Line } from '@oxy.so/bloom/icons/RiUpload2Line';
import { RiUserLine } from '@oxy.so/bloom/icons/RiUserLine';
import { RiGroupLine } from '@oxy.so/bloom/icons/RiGroupLine';
import { RiVideoLine } from '@oxy.so/bloom/icons/RiVideoLine';
import { RiWallet3Line } from '@oxy.so/bloom/icons/RiWallet3Line';
import { RiMagicLine } from '@oxy.so/bloom/icons/RiMagicLine';
import { RiTimerFlashLine } from '@oxy.so/bloom/icons/RiTimerFlashLine';
import { RiWifiLine } from '@oxy.so/bloom/icons/RiWifiLine';
import { RiWindyLine } from '@oxy.so/bloom/icons/RiWindyLine';
import { RiWrenchLine } from '@oxy.so/bloom/icons/RiWrenchLine';
import type { BloomIconComponent } from '@oxy.so/bloom/icons';

export interface PageIconEntry {
  name: string;
  Icon: BloomIconComponent;
  /** Lowercased search keywords. */
  keywords: string;
}

/**
 * Ordered list. `name` is what we encode into `Page.icon` as `icon:<name>`.
 * Keep `name` lowercase-kebab to keep the URI tidy.
 */
export const PAGE_ICONS: ReadonlyArray<PageIconEntry> = [
  { name: 'activity', Icon: RiPulseLine, keywords: 'activity pulse heart' },
  { name: 'airplay', Icon: RiAirplayLine, keywords: 'airplay cast' },
  { name: 'alarm-clock', Icon: RiAlarmLine, keywords: 'alarm clock time' },
  { name: 'album', Icon: RiAlbumLine, keywords: 'album music' },
  { name: 'alert-circle', Icon: RiErrorWarningLine, keywords: 'alert warning' },
  { name: 'alert-triangle', Icon: RiAlertLine, keywords: 'alert warning' },
  { name: 'anchor', Icon: RiAnchorLine, keywords: 'anchor boat sea' },
  { name: 'aperture', Icon: RiCameraLensLine, keywords: 'aperture camera' },
  { name: 'archive', Icon: RiArchiveLine, keywords: 'archive box' },
  { name: 'award', Icon: RiAwardLine, keywords: 'award trophy prize' },
  { name: 'backpack', Icon: RiHandbagLine, keywords: 'backpack school' },
  { name: 'banknote', Icon: RiMoneyDollarBoxLine, keywords: 'money cash bank' },
  { name: 'bar-chart', Icon: RiBarChartLine, keywords: 'chart graph bars' },
  { name: 'battery-full', Icon: RiBatteryLine, keywords: 'battery charge' },
  { name: 'beaker', Icon: RiFlaskLine, keywords: 'beaker science lab' },
  { name: 'bell', Icon: RiNotification3Line, keywords: 'bell notification' },
  { name: 'bike', Icon: RiBikeLine, keywords: 'bike bicycle' },
  { name: 'bird', Icon: RiQuillPenLine, keywords: 'bird animal' },
  { name: 'bitcoin', Icon: RiBtcLine, keywords: 'bitcoin crypto' },
  { name: 'bluetooth', Icon: RiBluetoothLine, keywords: 'bluetooth wireless' },
  { name: 'bolt', Icon: RiFlashlightLine, keywords: 'bolt power' },
  { name: 'book', Icon: RiBookLine, keywords: 'book read' },
  { name: 'book-open', Icon: RiBookOpenLine, keywords: 'book open read' },
  { name: 'bookmark', Icon: RiBookmarkLine, keywords: 'bookmark save' },
  { name: 'box', Icon: RiBox3Line, keywords: 'box package' },
  { name: 'briefcase', Icon: RiBriefcase4Line, keywords: 'briefcase work job' },
  { name: 'brush', Icon: RiBrushLine, keywords: 'brush paint art' },
  { name: 'bug', Icon: RiBugLine, keywords: 'bug insect issue' },
  { name: 'building', Icon: RiBuildingLine, keywords: 'building office' },
  { name: 'bus', Icon: RiBusLine, keywords: 'bus transport' },
  { name: 'cake', Icon: RiCake2Line, keywords: 'cake birthday' },
  { name: 'calculator', Icon: RiCalculatorLine, keywords: 'calculator math' },
  { name: 'calendar', Icon: RiCalendarLine, keywords: 'calendar date' },
  { name: 'camera', Icon: RiCameraLine, keywords: 'camera photo' },
  { name: 'car', Icon: RiCarLine, keywords: 'car vehicle' },
  { name: 'cat', Icon: RiBearSmileLine, keywords: 'cat animal pet' },
  { name: 'chart-bar', Icon: RiBarChartBoxLine, keywords: 'chart bars graph' },
  { name: 'chart-line', Icon: RiLineChartLine, keywords: 'chart line graph' },
  { name: 'chart-pie', Icon: RiPieChartLine, keywords: 'chart pie' },
  { name: 'check', Icon: RiCheckLine, keywords: 'check yes' },
  { name: 'check-square', Icon: RiCheckboxLine, keywords: 'check task done' },
  { name: 'cherry', Icon: RiAppleLine, keywords: 'cherry fruit' },
  { name: 'circle-help', Icon: RiQuestionLine, keywords: 'help question' },
  { name: 'clipboard', Icon: RiClipboardLine, keywords: 'clipboard copy' },
  { name: 'clock', Icon: RiTimeLine, keywords: 'clock time' },
  { name: 'cloud', Icon: RiCloudLine, keywords: 'cloud weather sky' },
  { name: 'coffee', Icon: RiCupLine, keywords: 'coffee drink' },
  { name: 'coins', Icon: RiCoinsLine, keywords: 'coins money' },
  { name: 'compass', Icon: RiCompass3Line, keywords: 'compass direction' },
  { name: 'construction', Icon: RiTrafficLightLine, keywords: 'construction build' },
  { name: 'cookie', Icon: RiCookieLine, keywords: 'cookie snack' },
  { name: 'cpu', Icon: RiCpuLine, keywords: 'cpu chip computer' },
  { name: 'credit-card', Icon: RiBankCardLine, keywords: 'credit card payment' },
  { name: 'crown', Icon: RiVipCrownLine, keywords: 'crown king queen royal' },
  { name: 'cup-soda', Icon: RiDrinks2Line, keywords: 'cup drink mug soda' },
  { name: 'database', Icon: RiDatabase2Line, keywords: 'database storage' },
  { name: 'diamond', Icon: RiVipDiamondLine, keywords: 'diamond gem' },
  { name: 'dog', Icon: RiBearSmileLine, keywords: 'dog animal pet' },
  { name: 'download', Icon: RiDownload2Line, keywords: 'download save' },
  { name: 'droplet', Icon: RiDropLine, keywords: 'droplet water' },
  { name: 'drum', Icon: RiDiscLine, keywords: 'drum music instrument' },
  { name: 'dumbbell', Icon: RiBoxingLine, keywords: 'dumbbell gym fitness' },
  { name: 'earth', Icon: RiEarthLine, keywords: 'earth world planet' },
  { name: 'egg', Icon: RiBowlLine, keywords: 'egg food' },
  { name: 'feather', Icon: RiQuillPenLine, keywords: 'feather light write' },
  { name: 'file', Icon: RiFileLine, keywords: 'file document' },
  { name: 'file-text', Icon: RiFileTextLine, keywords: 'file text document' },
  { name: 'film', Icon: RiFilmLine, keywords: 'film movie video' },
  { name: 'filter', Icon: RiFilter3Line, keywords: 'filter sort' },
  { name: 'fish', Icon: RiSailboatLine, keywords: 'fish animal' },
  { name: 'flag', Icon: RiFlagLine, keywords: 'flag mark' },
  { name: 'flame', Icon: RiFireLine, keywords: 'flame fire hot' },
  { name: 'flower', Icon: RiFlowerLine, keywords: 'flower plant' },
  { name: 'folder', Icon: RiFolderLine, keywords: 'folder directory' },
  { name: 'footprints', Icon: RiFootprintLine, keywords: 'footprints steps walk' },
  { name: 'gamepad-2', Icon: RiGamepadLine, keywords: 'gamepad game' },
  { name: 'gauge', Icon: RiDashboard3Line, keywords: 'gauge meter' },
  { name: 'gem', Icon: RiVipDiamondLine, keywords: 'gem diamond stone' },
  { name: 'gift', Icon: RiGiftLine, keywords: 'gift present' },
  { name: 'globe', Icon: RiGlobalLine, keywords: 'globe world' },
  { name: 'graduation-cap', Icon: RiGraduationCapLine, keywords: 'graduation cap school' },
  { name: 'grape', Icon: RiPlantLine, keywords: 'grape fruit' },
  { name: 'grid', Icon: RiLayoutGridLine, keywords: 'grid layout' },
  { name: 'hammer', Icon: RiHammerLine, keywords: 'hammer tool build' },
  { name: 'hand', Icon: RiHand, keywords: 'hand wave' },
  { name: 'hard-drive', Icon: RiHardDrive2Line, keywords: 'hard drive disk' },
  { name: 'hash', Icon: RiHashtag, keywords: 'hash tag number' },
  { name: 'headphones', Icon: RiHeadphoneLine, keywords: 'headphones music' },
  { name: 'heart', Icon: RiHeart3Line, keywords: 'heart love' },
  { name: 'help-circle', Icon: RiQuestionLine, keywords: 'help question' },
  { name: 'highlighter', Icon: RiMarkPenLine, keywords: 'highlighter mark' },
  { name: 'home', Icon: RiHome5Line, keywords: 'home house' },
  { name: 'ice-cream', Icon: RiCake3Line, keywords: 'ice cream dessert' },
  { name: 'inbox', Icon: RiInbox2Line, keywords: 'inbox mail' },
  { name: 'infinity', Icon: RiInfinityLine, keywords: 'infinity loop' },
  { name: 'info', Icon: RiInformationLine, keywords: 'info information' },
  { name: 'key', Icon: RiKey2Line, keywords: 'key unlock' },
  { name: 'keyboard', Icon: RiKeyboardLine, keywords: 'keyboard type' },
  { name: 'lamp', Icon: RiLightbulbLine, keywords: 'lamp light' },
  { name: 'laptop', Icon: RiMacbookLine, keywords: 'laptop computer' },
  { name: 'leaf', Icon: RiLeafLine, keywords: 'leaf plant nature' },
  { name: 'library', Icon: RiBookShelfLine, keywords: 'library books' },
  { name: 'life-buoy', Icon: RiLifebuoyLine, keywords: 'life buoy help support' },
  { name: 'lightbulb', Icon: RiLightbulbLine, keywords: 'lightbulb idea' },
  { name: 'link', Icon: RiLink, keywords: 'link url' },
  { name: 'lock', Icon: RiLockLine, keywords: 'lock secure' },
  { name: 'log-in', Icon: RiLoginBoxLine, keywords: 'login enter' },
  { name: 'mail', Icon: RiMailLine, keywords: 'mail email' },
  { name: 'map', Icon: RiMap2Line, keywords: 'map travel' },
  { name: 'map-pin', Icon: RiMapPinLine, keywords: 'map pin location' },
  { name: 'medal', Icon: RiMedalLine, keywords: 'medal award' },
  { name: 'megaphone', Icon: RiMegaphoneLine, keywords: 'megaphone announce' },
  { name: 'message-circle', Icon: RiChat3Line, keywords: 'message chat' },
  { name: 'mic', Icon: RiMicLine, keywords: 'mic microphone voice' },
  { name: 'monitor', Icon: RiComputerLine, keywords: 'monitor screen' },
  { name: 'moon', Icon: RiMoonLine, keywords: 'moon night dark' },
  { name: 'mountain', Icon: RiLandscapeLine, keywords: 'mountain travel' },
  { name: 'mouse', Icon: RiMouseLine, keywords: 'mouse computer' },
  { name: 'music', Icon: RiMusic2Line, keywords: 'music note' },
  { name: 'newspaper', Icon: RiNewspaperLine, keywords: 'newspaper news' },
  { name: 'notebook', Icon: RiBookletLine, keywords: 'notebook journal' },
  { name: 'package', Icon: RiBox3Line, keywords: 'package box' },
  { name: 'palette', Icon: RiPaletteLine, keywords: 'palette art color' },
  { name: 'panel-left', Icon: RiSideBarLine, keywords: 'panel sidebar' },
  { name: 'paperclip', Icon: RiAttachment2, keywords: 'paperclip attach' },
  { name: 'pause', Icon: RiPauseLine, keywords: 'pause stop' },
  { name: 'pen', Icon: RiPenNibLine, keywords: 'pen write' },
  { name: 'pencil', Icon: RiPencilLine, keywords: 'pencil write edit' },
  { name: 'phone', Icon: RiPhoneLine, keywords: 'phone call' },
  { name: 'pie-chart', Icon: RiPieChartLine, keywords: 'pie chart' },
  { name: 'pizza', Icon: RiRestaurantLine, keywords: 'pizza food' },
  { name: 'plane', Icon: RiPlaneLine, keywords: 'plane flight travel' },
  { name: 'play', Icon: RiPlayLine, keywords: 'play start' },
  { name: 'plug', Icon: RiPlugLine, keywords: 'plug power' },
  { name: 'plus', Icon: RiAddLine, keywords: 'plus add' },
  { name: 'printer', Icon: RiPrinterLine, keywords: 'printer print' },
  { name: 'puzzle', Icon: RiPuzzleLine, keywords: 'puzzle piece' },
  { name: 'quote', Icon: RiDoubleQuotesL, keywords: 'quote citation' },
  { name: 'radio', Icon: RiRadioLine, keywords: 'radio audio' },
  { name: 'rainbow', Icon: RiRainbowLine, keywords: 'rainbow color' },
  { name: 'receipt', Icon: RiReceiptLine, keywords: 'receipt invoice' },
  { name: 'recycle', Icon: RiRecycleLine, keywords: 'recycle eco' },
  { name: 'rocket', Icon: RiRocket2Line, keywords: 'rocket launch' },
  { name: 'save', Icon: RiSaveLine, keywords: 'save disk' },
  { name: 'scissors', Icon: RiScissorsLine, keywords: 'scissors cut' },
  { name: 'search', Icon: RiSearchLine, keywords: 'search find' },
  { name: 'send', Icon: RiSendPlaneLine, keywords: 'send share' },
  { name: 'server', Icon: RiServerLine, keywords: 'server hosting' },
  { name: 'settings', Icon: RiSettings3Line, keywords: 'settings gear' },
  { name: 'share', Icon: RiShareBoxLine, keywords: 'share send' },
  { name: 'shield', Icon: RiShieldLine, keywords: 'shield security' },
  { name: 'ship', Icon: RiShip2Line, keywords: 'ship boat' },
  { name: 'shopping-bag', Icon: RiShoppingBag3Line, keywords: 'shopping bag' },
  { name: 'shopping-cart', Icon: RiShoppingCartLine, keywords: 'cart shopping' },
  { name: 'smile', Icon: RiEmotionHappyLine, keywords: 'smile happy' },
  { name: 'snowflake', Icon: RiSnowflakeLine, keywords: 'snow winter' },
  { name: 'sparkles', Icon: RiSparklingLine, keywords: 'sparkles magic' },
  { name: 'speaker', Icon: RiSpeakerLine, keywords: 'speaker sound' },
  { name: 'star', Icon: RiStarLine, keywords: 'star favorite' },
  { name: 'sun', Icon: RiSunLine, keywords: 'sun day light' },
  { name: 'sword', Icon: RiSwordLine, keywords: 'sword weapon' },
  { name: 'tag', Icon: RiPriceTag3Line, keywords: 'tag label' },
  { name: 'target', Icon: RiFocus3Line, keywords: 'target goal aim' },
  { name: 'terminal', Icon: RiTerminalBoxLine, keywords: 'terminal console' },
  { name: 'thermometer', Icon: RiTempHotLine, keywords: 'thermometer temperature' },
  { name: 'thumbs-up', Icon: RiThumbUpLine, keywords: 'thumbs up like' },
  { name: 'ticket', Icon: RiTicketLine, keywords: 'ticket event' },
  { name: 'timer', Icon: RiTimerLine, keywords: 'timer countdown' },
  { name: 'train', Icon: RiTrainLine, keywords: 'train transport' },
  { name: 'trash', Icon: RiDeleteBinLine, keywords: 'trash delete' },
  { name: 'tree-pine', Icon: RiTreeLine, keywords: 'tree nature' },
  { name: 'trending-up', Icon: RiStockLine, keywords: 'trending up growth' },
  { name: 'trophy', Icon: RiTrophyLine, keywords: 'trophy award win' },
  { name: 'truck', Icon: RiTruckLine, keywords: 'truck delivery' },
  { name: 'tv', Icon: RiTvLine, keywords: 'tv television' },
  { name: 'umbrella', Icon: RiUmbrellaLine, keywords: 'umbrella rain' },
  { name: 'upload', Icon: RiUpload2Line, keywords: 'upload send' },
  { name: 'user', Icon: RiUserLine, keywords: 'user person' },
  { name: 'users', Icon: RiGroupLine, keywords: 'users team' },
  { name: 'utensils', Icon: RiRestaurantLine, keywords: 'utensils food restaurant' },
  { name: 'video', Icon: RiVideoLine, keywords: 'video camera record' },
  { name: 'wallet', Icon: RiWallet3Line, keywords: 'wallet money' },
  { name: 'wand', Icon: RiMagicLine, keywords: 'wand magic' },
  { name: 'watch', Icon: RiTimerFlashLine, keywords: 'watch time' },
  { name: 'wifi', Icon: RiWifiLine, keywords: 'wifi network' },
  { name: 'wind', Icon: RiWindyLine, keywords: 'wind weather' },
  { name: 'wrench', Icon: RiWrenchLine, keywords: 'wrench tool' },
  { name: 'zap', Icon: RiFlashlightLine, keywords: 'zap energy lightning' },
];

const PAGE_ICON_BY_NAME = new Map<string, BloomIconComponent>(
  PAGE_ICONS.map((entry) => [entry.name, entry.Icon]),
);

/** Lookup helper used by IconDisplay to render a stored `icon:<name>` value. */
export function getPageIcon(name: string): BloomIconComponent | null {
  return PAGE_ICON_BY_NAME.get(name) ?? null;
}
