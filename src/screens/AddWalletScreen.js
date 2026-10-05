// src/screens/AddWalletScreen.js
import React, { useMemo, useState } from 'react';
import {
  Alert,
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { getData, saveData } from '../utils/storage';
import { transferFromTotalToWallet } from '../utils/ledger';
import {
  palette,
  gradients,
  radius,
  spacing,
  shadow,
} from '../theme/design';

const money = (value) =>
  `₱${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export default function AddWalletScreen() {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [monthlyCap, setMonthlyCap] = useState('');
  const navigation = useNavigation();

  const previewName = name.trim() || 'New wallet';
  const previewAmount = Number(amount || 0);
  const previewCap = Number(monthlyCap || 0);

  const capPercent = useMemo(() => {
    if (!(previewCap > 0)) return 0;
    return Math.min(previewAmount / previewCap, 1);
  }, [previewAmount, previewCap]);

  const handleAddWallet = async () => {
    if (!name.trim() || !amount.trim()) {
      Alert.alert(
        'Incomplete',
        'Please enter a wallet name and initial amount.'
      );
      return;
    }

    const initAmt = parseFloat(amount);

    if (Number.isNaN(initAmt) || initAmt < 0) {
      Alert.alert(
        'Invalid amount',
        'Initial amount must be 0 or higher.'
      );
      return;
    }

    let capNum = null;

    if (monthlyCap.trim().length > 0) {
      const parsed = parseFloat(monthlyCap);

      if (Number.isNaN(parsed) || parsed < 0) {
        Alert.alert(
          'Invalid monthly cap',
          'Enter a number that is 0 or higher, or leave it blank.'
        );
        return;
      }

      capNum = parsed;
    }

    const wallets = (await getData('wallets')) || [];
    const id = Date.now().toString();

    const newWallet = {
      id,
      name: name.trim(),
      balance: 0,
      monthlyCap: capNum,
      expenses: [],
    };

    await saveData('wallets', [...wallets, newWallet]);

    if (initAmt > 0) {
      const res = await transferFromTotalToWallet(id, initAmt);

      if (!res.ok) {
        Alert.alert(
          'Wallet created',
          'The wallet was created, but the initial transfer could not be completed. Check your Total Balance.'
        );
      }
    }

    setName('');
    setAmount('');
    setMonthlyCap('');
    navigation.goBack();
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.intro}>
          <Text style={styles.eyebrow}>NEW WALLET</Text>
          <Text style={styles.pageTitle}>Give your money a purpose.</Text>
          <Text style={styles.pageSubtitle}>
            Create a wallet for a spending category, savings plan, or monthly budget.
          </Text>
        </View>

        <LinearGradient
          colors={gradients.wallet}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.previewCard}
        >
          <View style={styles.previewTop}>
            <View style={styles.previewIcon}>
              <Ionicons name="wallet-outline" size={22} color="#fff" />
            </View>

            <Text style={styles.previewTag}>WALLET PREVIEW</Text>
          </View>

          <Text style={styles.previewName}>{previewName}</Text>
          <Text style={styles.previewBalance}>{money(previewAmount)}</Text>
          <Text style={styles.previewBalanceLabel}>Starting balance</Text>

          {previewCap > 0 ? (
            <View style={styles.previewCap}>
              <View style={styles.previewCapRow}>
                <Text style={styles.previewCapLabel}>Monthly cap</Text>
                <Text style={styles.previewCapValue}>{money(previewCap)}</Text>
              </View>

              <View style={styles.previewTrack}>
                <View
                  style={[
                    styles.previewFill,
                    { width: `${capPercent * 100}%` },
                  ]}
                />
              </View>
            </View>
          ) : (
            <View style={styles.previewCapEmpty}>
              <Ionicons name="speedometer-outline" size={15} color="#C7DAF8" />
              <Text style={styles.previewCapEmptyText}>
                Add a monthly cap to track spending progress.
              </Text>
            </View>
          )}
        </LinearGradient>

        <View style={styles.formSection}>
          <Text style={styles.sectionLabel}>WALLET DETAILS</Text>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Wallet name</Text>
            <TextInput
              placeholder="e.g. Food & Drink"
              placeholderTextColor={palette.muted}
              value={name}
              onChangeText={setName}
              style={styles.input}
              selectionColor={palette.cyan}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Initial amount</Text>

            <View style={styles.amountRow}>
              <Text style={styles.currencyPrefix}>₱</Text>
              <TextInput
                placeholder="0.00"
                placeholderTextColor={palette.muted}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                style={styles.amountInput}
                selectionColor={palette.cyan}
              />
            </View>

            <View style={styles.inlineNote}>
              <Ionicons name="swap-horizontal-outline" size={14} color={palette.sub} />
              <Text style={styles.inlineNoteText}>
                This amount will be moved from your Total Balance into the wallet.
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.formSection}>
          <Text style={styles.sectionLabel}>MONTHLY CONTROL</Text>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Monthly spending cap</Text>

            <View style={styles.amountRow}>
              <Text style={styles.currencyPrefixMuted}>₱</Text>
              <TextInput
                placeholder="Optional"
                placeholderTextColor={palette.muted}
                value={monthlyCap}
                onChangeText={setMonthlyCap}
                keyboardType="decimal-pad"
                style={styles.amountInput}
                selectionColor={palette.cyan}
              />
            </View>
          </View>

          <View style={styles.capExplainer}>
            <View style={styles.capExplainerIcon}>
              <Ionicons name="analytics-outline" size={18} color={palette.cyan} />
            </View>

            <View style={styles.capExplainerCopy}>
              <Text style={styles.capExplainerTitle}>Why set a cap?</Text>
              <Text style={styles.capExplainerText}>
                Pengpeng can compare your monthly spending against this limit and surface budget warnings.
              </Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          onPress={handleAddWallet}
          activeOpacity={0.9}
          style={styles.createButtonWrap}
        >
          <LinearGradient
            colors={gradients.primary}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.createButton}
          >
            <Ionicons name="add-circle-outline" size={19} color="#fff" />
            <Text style={styles.createButtonText}>Create wallet</Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.cancelButton}
          activeOpacity={0.82}
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: palette.bg,
  },

  content: {
    paddingHorizontal: spacing.l,
    paddingTop: 14,
    paddingBottom: 48,
  },

  intro: {
    marginBottom: 18,
  },

  eyebrow: {
    color: palette.cyan,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 6,
  },

  pageTitle: {
    color: palette.text,
    fontSize: 29,
    lineHeight: 35,
    fontWeight: '900',
    letterSpacing: -0.7,
    maxWidth: 330,
  },

  pageSubtitle: {
    color: palette.sub,
    fontSize: 12,
    lineHeight: 19,
    marginTop: 7,
    maxWidth: 430,
  },

  previewCard: {
    borderRadius: 29,
    padding: 20,
    overflow: 'hidden',
    ...shadow(9, 0.22),
  },

  previewTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  previewIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
  },

  previewTag: {
    color: '#D6E6FF',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.1,
  },

  previewName: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.35,
    marginTop: 20,
  },

  previewBalance: {
    color: '#fff',
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '900',
    letterSpacing: -0.9,
    marginTop: 4,
  },

  previewBalanceLabel: {
    color: '#C3D8F6',
    fontSize: 10,
    marginTop: 1,
  },

  previewCap: {
    marginTop: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.16)',
  },

  previewCapRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  previewCapLabel: {
    color: '#BED2EF',
    fontSize: 9,
    fontWeight: '700',
  },

  previewCapValue: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
  },

  previewTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
    marginTop: 9,
  },

  previewFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#8FEAFF',
  },

  previewCapEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.16)',
  },

  previewCapEmptyText: {
    color: '#C7DAF8',
    fontSize: 9,
    marginLeft: 6,
  },

  formSection: {
    paddingTop: 25,
    paddingBottom: 21,
    borderBottomWidth: 1,
    borderBottomColor: palette.hairline,
  },

  sectionLabel: {
    color: palette.primaryStrong,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.35,
    marginBottom: 16,
  },

  field: {
    marginBottom: 19,
  },

  fieldLabel: {
    color: palette.textSoft,
    fontSize: 10,
    fontWeight: '800',
    marginBottom: 7,
  },

  input: {
    minHeight: 50,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderStrong,
    color: palette.text,
    fontSize: 16,
    paddingHorizontal: 0,
    paddingVertical: 10,
  },

  amountRow: {
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

  currencyPrefixMuted: {
    color: palette.primaryStrong,
    fontSize: 22,
    fontWeight: '900',
    marginRight: 8,
  },

  amountInput: {
    flex: 1,
    minHeight: 52,
    color: palette.text,
    fontSize: 21,
    fontWeight: '900',
    paddingVertical: 9,
  },

  inlineNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
  },

  inlineNoteText: {
    flex: 1,
    color: palette.sub,
    fontSize: 9,
    lineHeight: 14,
    marginLeft: 6,
  },

  capExplainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 2,
  },

  capExplainerIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: palette.cyanSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },

  capExplainerCopy: {
    flex: 1,
  },

  capExplainerTitle: {
    color: palette.text,
    fontSize: 12,
    fontWeight: '800',
  },

  capExplainerText: {
    color: palette.sub,
    fontSize: 9,
    lineHeight: 14,
    marginTop: 3,
  },

  createButtonWrap: {
    borderRadius: radius.pill,
    overflow: 'hidden',
    marginTop: 27,
    ...shadow(8, 0.22),
  },

  createButton: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  createButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
    marginLeft: 7,
  },

  cancelButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },

  cancelButtonText: {
    color: palette.sub,
    fontSize: 11,
    fontWeight: '800',
  },
});
