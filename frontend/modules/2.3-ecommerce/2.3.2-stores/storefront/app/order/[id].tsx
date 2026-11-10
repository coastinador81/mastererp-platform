import { useLocalSearchParams } from 'expo-router';
import { OrderDetailExperience } from '@/features/OrdersExperience';
export default function OrderPage(){const{id}=useLocalSearchParams<{id:string}>();return <OrderDetailExperience id={id}/>;}
