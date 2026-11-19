import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, usePathname, useRouter } from 'expo-router';
import { Alert, Image, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import {useState} from 'react';
import { colors, contentWidth, spacing } from '../theme';
import { useStore } from '../store/StoreProvider';
import { HeaderMenu } from './HeaderMenu';

export function StoreHeader() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const compact = Platform.OS === 'web' || width < 700;
  const pathname = usePathname();
  const { catalog, cart, selectedNode, selectNode, loading } = useStore();
  const [nodesOpen,setNodesOpen]=useState(false);
  const count = cart.reduce((total, line) => total + line.quantity, 0);
  const storeName = catalog?.store.name || '';
  const selectedNodeName = catalog?.store.nodes.find(item=>item.id===selectedNode)?.name||'Seleccionar nodo';
  const configuredLogoUrl = catalog?.store.branding?.logoUrl;
  const switchNode = (id: string) => {
    const apply = () => { setNodesOpen(false); void selectNode(id); };
    if (!count) { apply(); return; }
    if (Platform.OS === 'web') {
      if (globalThis.confirm('Cambiar de nodo vaciará el carrito actual. ¿Deseas continuar?')) apply();
      return;
    }
    Alert.alert('Cambiar nodo', 'Cambiar de nodo vaciará el carrito actual.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cambiar', style: 'destructive', onPress: apply },
    ]);
  };
  const logoUrl = configuredLogoUrl?.startsWith('https://') ? configuredLogoUrl : '';
  return (
    <View style={styles.shell}>
      <View style={styles.header}>
        {compact ? <HeaderMenu /> : null}
        <Pressable style={styles.brand} onPress={() => router.push('/')} accessibilityLabel="Ir al inicio">
          <View style={[styles.mark, storeName && {backgroundColor:catalog?.store.branding?.primaryColor||colors.primary}, logoUrl && styles.logoMark, !storeName && styles.markLoading]}>{logoUrl ? <Image source={{uri:logoUrl}} style={styles.logo} resizeMode="contain" /> : storeName ? <Text style={styles.markText}>{storeName.slice(0,1).toUpperCase()}</Text> : null}</View>
          <View style={styles.brandCopy}>{storeName ? <Text style={styles.name} numberOfLines={1}>{storeName}</Text> : <View style={styles.nameLoading} />}{compact || !storeName ? null : <Text style={styles.tag}>Tu tienda, a tu manera</Text>}</View>
        </Pressable>
        {compact ? null : <View style={styles.nav}>
          <Link href="/" asChild><Pressable><Text style={[styles.link, pathname === '/' && styles.active]}>Inicio</Text></Pressable></Link>
          <Link href="/catalog" asChild><Pressable><Text style={[styles.link, pathname === '/catalog' && styles.active]}>Catálogo</Text></Pressable></Link>
        </View>}
        <View style={[styles.actions, compact && styles.actionsCompact]}>
          {(catalog?.store.nodes?.length||0)>1 ? <View style={styles.nodeWrap}><Pressable style={[styles.nodeButton,compact&&styles.nodeButtonCompact]} disabled={loading} onPress={()=>setNodesOpen(value=>!value)} accessibilityLabel={`Nodo: ${selectedNodeName}`} accessibilityRole="button" accessibilityState={{expanded:nodesOpen}}><Ionicons name="location-outline" size={compact?21:17} color={colors.primaryDark}/>{compact?null:<><Text style={styles.nodeText} numberOfLines={1}>{selectedNodeName}</Text><Ionicons name={nodesOpen?'chevron-up':'chevron-down'} size={15} color={colors.muted}/></>}</Pressable>{nodesOpen?<View style={styles.nodeMenu}><View style={styles.nodeMenuHeading}><Text style={styles.nodeMenuLabel}>Nodo seleccionado</Text><Text style={styles.nodeMenuCurrent}>{selectedNodeName}</Text></View>{catalog?.store.nodes.map(item=><Pressable key={item.id} style={[styles.nodeOption,item.id===selectedNode&&styles.nodeSelected]} onPress={()=>switchNode(item.id)}><Text style={[styles.nodeOptionText,item.id===selectedNode&&styles.nodeSelectedText]}>{item.name}</Text>{item.id===selectedNode?<Ionicons name="checkmark" size={16} color={colors.primaryDark}/>:null}</Pressable>)}</View>:null}</View>:null}
          <Pressable style={styles.cart} onPress={() => router.push('/cart')} accessibilityLabel={`Carrito con ${count} productos`}>
            <Ionicons name="bag-handle-outline" size={22} color={colors.surface} />
            {count > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{count}</Text></View> : null}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { position: 'relative', zIndex: 1000, elevation: 20, overflow: 'visible', backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.line },
  header: { position: 'relative', zIndex: 1001, width: '100%', maxWidth: contentWidth, minHeight: 76, alignSelf: 'center', overflow: 'visible', paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  brand: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minWidth: 0 },
  brandCopy: { flexShrink: 1, minWidth: 0 },
  mark: { width: 39, height: 39, flexShrink: 0, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  markLoading: { backgroundColor: colors.line },
  logoMark: { backgroundColor: colors.surface },
  logo: { width: 31, height: 31, borderRadius: 9 },
  markText: { color: colors.surface, fontSize: 21, fontWeight: '900' },
  name: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  nameLoading: { width: 145, height: 16, borderRadius: 8, backgroundColor: colors.line },
  tag: { color: colors.muted, fontSize: 10 },
  nav: { flexDirection: 'row', gap: spacing.lg },
  link: { color: colors.muted, fontSize: 14, fontWeight: '700', paddingVertical: 10 },
  active: { color: colors.primary },
  actions: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm },
  actionsCompact: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
  nodeWrap:{position:'relative',zIndex:1002,elevation:21,overflow:'visible'},nodeButton:{maxWidth:210,minHeight:43,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,paddingHorizontal:11,borderWidth:1,borderColor:colors.line,borderRadius:12,backgroundColor:colors.surface},nodeButtonCompact:{width:43,paddingHorizontal:0},nodeText:{maxWidth:140,color:colors.ink,fontSize:12,fontWeight:'800'},nodeMenu:{position:'absolute',zIndex:1003,elevation:22,top:48,right:0,minWidth:225,padding:6,borderWidth:1,borderColor:colors.line,borderRadius:12,backgroundColor:colors.surface,boxShadow:'0 10px 25px rgba(16,24,40,.14)'},nodeMenuHeading:{paddingHorizontal:11,paddingTop:8,paddingBottom:7,borderBottomWidth:1,borderBottomColor:colors.line},nodeMenuLabel:{color:colors.muted,fontSize:10,fontWeight:'700',textTransform:'uppercase'},nodeMenuCurrent:{marginTop:3,color:colors.ink,fontSize:12,fontWeight:'900'},nodeOption:{paddingHorizontal:11,paddingVertical:10,borderRadius:8,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},nodeSelected:{backgroundColor:colors.primarySoft},nodeOptionText:{color:colors.ink,fontSize:12,fontWeight:'700'},nodeSelectedText:{color:colors.primaryDark},
  cart: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.primary },
  badge: { position: 'absolute', top: -5, right: -5, minWidth: 20, height: 20, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.surface },
  badgeText: { color: colors.ink, fontSize: 10, fontWeight: '900' },
});
