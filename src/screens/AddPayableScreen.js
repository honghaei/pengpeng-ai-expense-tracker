// src/screens/AddPayableScreen.js
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  Alert,
  SafeAreaView,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import {
  palette,
  gradients,
  radius,
  spacing,
  shadow,
} from '../theme/design';

import { getData } from '../utils/storage';
import { createBill, createSubscription } from '../utils/payables';

const two = (n) => (n < 10 ? `0${n}` : `${n}`);

const ymd = (d) => {
  if (!d) return '';
  const dd = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dd.getTime())) return '';

  return `${dd.getFullYear()}-${two(dd.getMonth() + 1)}-${two(
    dd.getDate()
  )}`;
};

const friendlyDate = (date) => {
  if (!date) return 'Choose a date';

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

export default function AddPayableScreen() {
  const nav = useNavigation();
  const { params } = useRoute();

  const defaultType =
    params?.defaultType === 'subscription' ? 'subscription' : 'bill';

  const [wallets, setWallets] = useState([]);

  const [formType, setFormType] = useState(defaultType);
  const [formName, setFormName] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formSource, setFormSource] = useState('wallet');
  const [formWalletId, setFormWalletId] = useState(null);
  const [formDue, setFormDue] = useState(new Date());

  const [subCadenceUnit, setSubCadenceUnit] = useState('month');
  const [formAutopay, setFormAutopay] = useState(true);

  const [showIOSPicker, setShowIOSPicker] = useState(false);

  useEffect(() => {
    (async () => {
      const savedWallets = (await getData('wallets')) || [];
      setWallets(savedWallets);

      if (savedWallets.length > 0) {
        setFormWalletId((current) => current || savedWallets[0].id);
      } else {
        setFormSource('total');
      }
    })();
  }, []);

  const openDatePicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: formDue || new Date(),
        mode: 'date',
        is24Hour: true,
        onChange: (_evt, selected) => {
          if (selected) setFormDue(new Date(selected));
        },
      });

      return;
    }

    setShowIOSPicker(true);
  };

  const onSave = async () => {
    const isSub = formType === 'subscription';

    if (!formName.trim()) {
      return Alert.alert('Incomplete', 'Please enter a name.');
    }

    if (!(Number(formAmount) > 0)) {
      return Alert.alert('Invalid amount', 'Enter a positive amount.');
    }

    if (formSource === 'wallet' && !formWalletId) {
      return Alert.alert('Pick a wallet', 'Choose where to deduct.');
    }

    const payload = {
      name: formName.trim(),
      amountType: isSub ? 'fixed' : 'variable',
      amount: Number(formAmount || 0),
      defaultSource: formSource,
      walletId: formSource === 'wallet' ? formWalletId : null,
      nextDueDate:
        formDue?.toISOString?.() || new Date().toISOString(),
    };

    if (isSub) {
      await createSubscription({
        ...payload,
        cadence: {
          unit: subCadenceUnit,
          every: 1,
        },
        autopay: formAutopay,
      });
    } else {
      await createBill(payload);
    }

    nav.goBack();
  };

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.safeHeader}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => nav.goBack()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.headerAction}
          >
            <Ionicons
              name="close"
              size={22}
              color={palette.textSoft}
            />
          </TouchableOpacity>

          <Text style={styles.headerTitle}>
            {formType === 'subscription'
              ? 'New subscription'
              : 'New bill'}
          </Text>

          <TouchableOpacity
            onPress={onSave}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.saveHeaderButton}
          >
            <Text style={styles.saveHeaderText}>Save</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.eyebrow}>ADD PAYMENT</Text>
        <Text style={styles.pageTitle}>
          Set it once. Stay ahead of it.
        </Text>

        <View style={styles.typeSwitch}>
          {[
            {
              key: 'bill',
              label: 'Bill',
              icon: 'receipt-outline',
            },
            {
              key: 'subscription',
              label: 'Subscription',
              icon: 'repeat-outline',
            },
          ].map((item) => {
            const active = formType === item.key;

            return (
              <TouchableOpacity
                key={item.key}
                onPress={() => setFormType(item.key)}
                activeOpacity={0.84}
                style={[
                  styles.typeOption,
                  active && styles.typeOptionActive,
                ]}
              >
                <Ionicons
                  name={item.icon}
                  size={18}
                  color={active ? palette.cyan : palette.sub}
                />

                <Text
                  style={[
                    styles.typeOptionText,
                    active && styles.typeOptionTextActive,
                  ]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.formSection}>
          <Text style={styles.sectionLabel}>DETAILS</Text>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>
              {formType === 'subscription'
                ? 'Subscription name'
                : 'Bill name'}
            </Text>

            <TextInput
              value={formName}
              onChangeText={setFormName}
              placeholder={
                formType === 'subscription'
                  ? 'e.g. Netflix, Spotify'
                  : 'e.g. Electricity, Water'
              }
              placeholderTextColor={palette.muted}
              style={styles.input}
              selectionColor={palette.cyan}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Amount</Text>

            <View style={styles.amountInputShell}>
              <Text style={styles.currencyPrefix}>₱</Text>

              <TextInput
                value={formAmount}
                onChangeText={setFormAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={palette.muted}
                style={styles.amountInput}
                selectionColor={palette.cyan}
              />
            </View>
          </View>
        </View>

        <View style={styles.formSection}>
          <Text style={styles.sectionLabel}>PAYMENT SOURCE</Text>

          <TouchableOpacity
            onPress={() => setFormSource('total')}
            style={styles.sourceRow}
            activeOpacity={0.84}
          >
            <View
              style={[
                styles.sourceIcon,
                formSource === 'total' &&
                  styles.sourceIconActive,
              ]}
            >
              <Ionicons
                name="cash-outline"
                size={19}
                color={
                  formSource === 'total'
                    ? palette.cyan
                    : palette.sub
                }
              />
            </View>

            <View style={styles.sourceCopy}>
              <Text style={styles.sourceTitle}>
                Total balance
              </Text>
              <Text style={styles.sourceSubtitle}>
                Deduct directly from your available cash.
              </Text>
            </View>

            <View
              style={[
                styles.radioOuter,
                formSource === 'total' &&
                  styles.radioOuterActive,
              ]}
            >
              {formSource === 'total' ? (
                <View style={styles.radioInner} />
              ) : null}
            </View>
          </TouchableOpacity>

          {wallets.length > 0 ? (
            <>
              <Text style={styles.walletLabel}>
                Or choose a wallet
              </Text>

              {wallets.map((wallet) => {
                const active =
                  formSource === 'wallet' &&
                  formWalletId === wallet.id;

                return (
                  <TouchableOpacity
                    key={wallet.id}
                    onPress={() => {
                      setFormSource('wallet');
                      setFormWalletId(wallet.id);
                    }}
                    style={styles.walletRow}
                    activeOpacity={0.84}
                  >
                    <View
                      style={[
                        styles.walletDot,
                        active && styles.walletDotActive,
                      ]}
                    />

                    <Text style={styles.walletName}>
                      {wallet.name}
                    </Text>

                    <Ionicons
                      name={
                        active
                          ? 'checkmark-circle'
                          : 'ellipse-outline'
                      }
                      size={20}
                      color={
                        active
                          ? palette.cyan
                          : palette.muted
                      }
                    />
                  </TouchableOpacity>
                );
              })}
            </>
          ) : null}
        </View>

        <View style={styles.formSection}>
          <Text style={styles.sectionLabel}>SCHEDULE</Text>

          <TouchableOpacity
            onPress={openDatePicker}
            style={styles.dateRow}
            activeOpacity={0.84}
          >
            <View style={styles.dateIcon}>
              <Ionicons
                name="calendar-outline"
                size={19}
                color={palette.cyan}
              />
            </View>

            <View style={styles.dateCopy}>
              <Text style={styles.label}>Next due date</Text>
              <Text style={styles.dateValue}>
                {friendlyDate(formDue)}
              </Text>
            </View>

            <Ionicons
              name="chevron-forward"
              size={18}
              color={palette.muted}
            />
          </TouchableOpacity>

          {Platform.OS === 'ios' && showIOSPicker ? (
            <View style={styles.pickerCard}>
              <DateTimePicker
                value={formDue || new Date()}
                mode="date"
                display="spinner"
                themeVariant="dark"
                onChange={(_e, d) => {
                  if (d) setFormDue(d);
                }}
                style={{ alignSelf: 'stretch' }}
              />

              <TouchableOpacity
                onPress={() => setShowIOSPicker(false)}
                style={styles.pickerDone}
              >
                <Text style={styles.pickerDoneText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        {formType === 'subscription' ? (
          <View style={styles.formSection}>
            <Text style={styles.sectionLabel}>
              SUBSCRIPTION SETTINGS
            </Text>

            <View style={styles.cadenceRow}>
              <Text style={styles.settingTitle}>
                Billing frequency
              </Text>

              <View style={styles.inlineOptions}>
                {[
                  { key: 'month', label: 'Monthly' },
                  { key: 'year', label: 'Yearly' },
                ].map((item) => {
                  const active =
                    subCadenceUnit === item.key;

                  return (
                    <TouchableOpacity
                      key={item.key}
                      onPress={() =>
                        setSubCadenceUnit(item.key)
                      }
                      style={[
                        styles.inlineOption,
                        active &&
                          styles.inlineOptionActive,
                      ]}
                      activeOpacity={0.84}
                    >
                      <Text
                        style={[
                          styles.inlineOptionText,
                          active &&
                            styles.inlineOptionTextActive,
                        ]}
                      >
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <TouchableOpacity
              onPress={() =>
                setFormAutopay(!formAutopay)
              }
              style={styles.autopayRow}
              activeOpacity={0.84}
            >
              <View style={styles.autopayCopy}>
                <Text style={styles.settingTitle}>
                  Autopay
                </Text>
                <Text style={styles.settingSubtitle}>
                  Automatically pay when the due date arrives.
                </Text>
              </View>

              <View
                style={[
                  styles.switchTrack,
                  formAutopay &&
                    styles.switchTrackActive,
                ]}
              >
                <View
                  style={[
                    styles.switchThumb,
                    formAutopay &&
                      styles.switchThumbActive,
                  ]}
                />
              </View>
            </TouchableOpacity>
          </View>
        ) : null}

        <LinearGradient
          colors={gradients.primary}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.saveButtonGradient}
        >
          <TouchableOpacity
            onPress={onSave}
            activeOpacity={0.88}
            style={styles.saveButton}
          >
            <Ionicons
              name={
                formType === 'subscription'
                  ? 'repeat-outline'
                  : 'receipt-outline'
              }
              size={18}
              color="#fff"
            />

            <Text style={styles.saveButtonText}>
              {formType === 'subscription'
                ? 'Add subscription'
                : 'Add bill'}
            </Text>
          </TouchableOpacity>
        </LinearGradient>

        <Text style={styles.footerHint}>
          You can update payment status and schedules later.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: palette.bg,
  },

  safeHeader: {
    backgroundColor: palette.bg,
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
  },

  headerRow: {
    height: 54,
    paddingHorizontal: spacing.l,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  headerAction: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.bgSoft,
  },

  headerTitle: {
    color: palette.text,
    fontWeight: '900',
    fontSize: 15,
  },

  saveHeaderButton: {
    minHeight: 34,
    paddingHorizontal: 13,
    borderRadius: radius.pill,
    backgroundColor: palette.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  saveHeaderText: {
    color: palette.cyan,
    fontWeight: '900',
    fontSize: 11,
  },

  body: {
    paddingHorizontal: spacing.l,
    paddingTop: 20,
    paddingBottom: 44,
  },

  eyebrow: {
    color: palette.cyan,
    fontWeight: '900',
    fontSize: 9,
    letterSpacing: 1.5,
    marginBottom: 6,
  },

  pageTitle: {
    color: palette.text,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '900',
    letterSpacing: -0.65,
    maxWidth: 320,
  },

  typeSwitch: {
    flexDirection: 'row',
    marginTop: 20,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
  },

  typeOption: {
    flex: 1,
    minHeight: 46,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.hairline,
    backgroundColor: palette.bgSoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },

  typeOptionActive: {
    borderColor: palette.borderStrong,
    backgroundColor: palette.primarySoft,
  },

  typeOptionText: {
    color: palette.sub,
    fontWeight: '800',
    fontSize: 12,
    marginLeft: 7,
  },

  typeOptionTextActive: {
    color: palette.text,
  },

  formSection: {
    paddingTop: 24,
    paddingBottom: 22,
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
  },

  sectionLabel: {
    color: palette.primaryStrong,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.35,
    marginBottom: 14,
  },

  fieldGroup: {
    marginBottom: 17,
  },

  label: {
    color: palette.textSoft,
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 7,
  },

  input: {
    minHeight: 50,
    backgroundColor: 'transparent',
    color: palette.text,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderStrong,
    paddingHorizontal: 0,
    paddingVertical: 10,
    fontSize: 16,
  },

  amountInputShell: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: palette.borderStrong,
  },

  currencyPrefix: {
    color: palette.cyan,
    fontSize: 22,
    fontWeight: '900',
    marginRight: 8,
  },

  amountInput: {
    flex: 1,
    minHeight: 54,
    color: palette.text,
    fontSize: 22,
    fontWeight: '900',
    paddingVertical: 10,
  },

  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
  },

  sourceIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.bgSoft,
    marginRight: 12,
  },

  sourceIconActive: {
    backgroundColor: palette.cyanSoft,
  },

  sourceCopy: {
    flex: 1,
  },

  sourceTitle: {
    color: palette.text,
    fontSize: 14,
    fontWeight: '800',
  },

  sourceSubtitle: {
    color: palette.sub,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },

  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },

  radioOuterActive: {
    borderColor: palette.cyan,
  },

  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.cyan,
  },

  walletLabel: {
    color: palette.muted,
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 10,
    marginBottom: 3,
  },

  walletRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
  },

  walletDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.muted,
    marginRight: 10,
  },

  walletDotActive: {
    backgroundColor: palette.cyan,
  },

  walletName: {
    flex: 1,
    color: palette.textSoft,
    fontSize: 12,
    fontWeight: '700',
  },

  dateRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
  },

  dateIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: palette.cyanSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },

  dateCopy: {
    flex: 1,
  },

  dateValue: {
    color: palette.text,
    fontSize: 15,
    fontWeight: '800',
  },

  pickerCard: {
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    marginTop: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: palette.borderStrong,
  },

  pickerDone: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: palette.hairline,
  },

  pickerDoneText: {
    color: palette.cyan,
    fontSize: 12,
    fontWeight: '900',
  },

  cadenceRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  settingTitle: {
    color: palette.text,
    fontSize: 13,
    fontWeight: '800',
  },

  settingSubtitle: {
    color: palette.sub,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 3,
    maxWidth: 240,
  },

  inlineOptions: {
    flexDirection: 'row',
  },

  inlineOption: {
    minHeight: 34,
    paddingHorizontal: 11,
    borderRadius: radius.pill,
    justifyContent: 'center',
    backgroundColor: palette.bgSoft,
    marginLeft: 7,
  },

  inlineOptionActive: {
    backgroundColor: palette.primarySoft,
  },

  inlineOptionText: {
    color: palette.sub,
    fontSize: 10,
    fontWeight: '800',
  },

  inlineOptionTextActive: {
    color: palette.cyan,
  },

  autopayRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 7,
  },

  autopayCopy: {
    flex: 1,
  },

  switchTrack: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: palette.surface3,
    padding: 3,
    justifyContent: 'center',
  },

  switchTrackActive: {
    backgroundColor: palette.primary,
  },

  switchThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: palette.textSoft,
  },

  switchThumbActive: {
    alignSelf: 'flex-end',
    backgroundColor: '#fff',
  },

  saveButtonGradient: {
    marginTop: 26,
    borderRadius: radius.pill,
    overflow: 'hidden',
    ...shadow(8, 0.22),
  },

  saveButton: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  saveButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
    marginLeft: 7,
  },

  footerHint: {
    color: palette.muted,
    textAlign: 'center',
    fontSize: 10,
    lineHeight: 15,
    marginTop: 12,
  },
});
