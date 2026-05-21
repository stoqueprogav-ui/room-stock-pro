export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      categorias: {
        Row: {
          created_at: string
          id: string
          nome: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          nome: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      conversation_participants: {
        Row: {
          added_at: string
          conversation_id: string
          user_id: string
        }
        Insert: {
          added_at?: string
          conversation_id: string
          user_id: string
        }
        Update: {
          added_at?: string
          conversation_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_reads: {
        Row: {
          conversation_id: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_reads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          owner_user_id: string | null
          related_emprestimo_id: string | null
          related_requisicao_id: string | null
          sala_id: string | null
          title: string | null
          type: Database["public"]["Enums"]["conversation_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          owner_user_id?: string | null
          related_emprestimo_id?: string | null
          related_requisicao_id?: string | null
          sala_id?: string | null
          title?: string | null
          type: Database["public"]["Enums"]["conversation_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          owner_user_id?: string | null
          related_emprestimo_id?: string | null
          related_requisicao_id?: string | null
          sala_id?: string | null
          title?: string | null
          type?: Database["public"]["Enums"]["conversation_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
        ]
      }
      devolucao_itens: {
        Row: {
          devolucao_id: string
          emprestimo_item_id: string
          id: string
          produto_id: string
          quantidade: number
        }
        Insert: {
          devolucao_id: string
          emprestimo_item_id: string
          id?: string
          produto_id: string
          quantidade: number
        }
        Update: {
          devolucao_id?: string
          emprestimo_item_id?: string
          id?: string
          produto_id?: string
          quantidade?: number
        }
        Relationships: [
          {
            foreignKeyName: "devolucao_itens_devolucao_id_fkey"
            columns: ["devolucao_id"]
            isOneToOne: false
            referencedRelation: "devolucoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devolucao_itens_emprestimo_item_id_fkey"
            columns: ["emprestimo_item_id"]
            isOneToOne: false
            referencedRelation: "emprestimo_itens"
            referencedColumns: ["id"]
          },
        ]
      }
      devolucoes: {
        Row: {
          created_at: string
          emprestimo_id: string
          id: string
          observacao: string | null
          usuario_id: string
        }
        Insert: {
          created_at?: string
          emprestimo_id: string
          id?: string
          observacao?: string | null
          usuario_id: string
        }
        Update: {
          created_at?: string
          emprestimo_id?: string
          id?: string
          observacao?: string | null
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "devolucoes_emprestimo_id_fkey"
            columns: ["emprestimo_id"]
            isOneToOne: false
            referencedRelation: "emprestimos"
            referencedColumns: ["id"]
          },
        ]
      }
      dividas: {
        Row: {
          id: string
          produto_id: string
          sala_credora_id: string
          sala_devedora_id: string
          saldo: number
          updated_at: string
        }
        Insert: {
          id?: string
          produto_id: string
          sala_credora_id: string
          sala_devedora_id: string
          saldo?: number
          updated_at?: string
        }
        Update: {
          id?: string
          produto_id?: string
          sala_credora_id?: string
          sala_devedora_id?: string
          saldo?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dividas_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dividas_sala_credora_id_fkey"
            columns: ["sala_credora_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dividas_sala_devedora_id_fkey"
            columns: ["sala_devedora_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
        ]
      }
      emprestimo_itens: {
        Row: {
          emprestimo_id: string
          id: string
          produto_id: string
          quantidade: number
          quantidade_devolvida: number
        }
        Insert: {
          emprestimo_id: string
          id?: string
          produto_id: string
          quantidade: number
          quantidade_devolvida?: number
        }
        Update: {
          emprestimo_id?: string
          id?: string
          produto_id?: string
          quantidade?: number
          quantidade_devolvida?: number
        }
        Relationships: [
          {
            foreignKeyName: "emprestimo_itens_emprestimo_id_fkey"
            columns: ["emprestimo_id"]
            isOneToOne: false
            referencedRelation: "emprestimos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emprestimo_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      emprestimos: {
        Row: {
          created_at: string
          decidido_em: string | null
          decidido_por: string | null
          id: string
          observacao: string | null
          retirado_em: string | null
          retirado_por: string | null
          sala_destino_id: string
          sala_origem_id: string
          solicitante_id: string | null
          status: Database["public"]["Enums"]["emprestimo_status"]
        }
        Insert: {
          created_at?: string
          decidido_em?: string | null
          decidido_por?: string | null
          id?: string
          observacao?: string | null
          retirado_em?: string | null
          retirado_por?: string | null
          sala_destino_id: string
          sala_origem_id: string
          solicitante_id?: string | null
          status?: Database["public"]["Enums"]["emprestimo_status"]
        }
        Update: {
          created_at?: string
          decidido_em?: string | null
          decidido_por?: string | null
          id?: string
          observacao?: string | null
          retirado_em?: string | null
          retirado_por?: string | null
          sala_destino_id?: string
          sala_origem_id?: string
          solicitante_id?: string | null
          status?: Database["public"]["Enums"]["emprestimo_status"]
        }
        Relationships: [
          {
            foreignKeyName: "emprestimos_decidido_por_fkey"
            columns: ["decidido_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emprestimos_sala_destino_id_fkey"
            columns: ["sala_destino_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emprestimos_sala_origem_id_fkey"
            columns: ["sala_origem_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emprestimos_solicitante_id_fkey"
            columns: ["solicitante_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      estoque: {
        Row: {
          id: string
          produto_id: string
          quantidade: number
          sala_id: string
          updated_at: string
        }
        Insert: {
          id?: string
          produto_id: string
          quantidade?: number
          sala_id: string
          updated_at?: string
        }
        Update: {
          id?: string
          produto_id?: string
          quantidade?: number
          sala_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estoque_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachment_name: string | null
          attachment_path: string | null
          attachment_type: string | null
          body: string | null
          conversation_id: string
          created_at: string
          id: string
          sender_id: string
        }
        Insert: {
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_type?: string | null
          body?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          sender_id: string
        }
        Update: {
          attachment_name?: string | null
          attachment_path?: string | null
          attachment_type?: string | null
          body?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      movimentacoes: {
        Row: {
          created_at: string
          id: string
          observacao: string | null
          produto_id: string
          quantidade: number
          referencia_id: string | null
          referencia_tipo: string | null
          sala_id: string
          saldo_apos: number
          tipo: Database["public"]["Enums"]["movimentacao_tipo"]
          usuario_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          observacao?: string | null
          produto_id: string
          quantidade: number
          referencia_id?: string | null
          referencia_tipo?: string | null
          sala_id: string
          saldo_apos: number
          tipo: Database["public"]["Enums"]["movimentacao_tipo"]
          usuario_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          observacao?: string | null
          produto_id?: string
          quantidade?: number
          referencia_id?: string | null
          referencia_tipo?: string | null
          sala_id?: string
          saldo_apos?: number
          tipo?: Database["public"]["Enums"]["movimentacao_tipo"]
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "movimentacoes_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      produtos: {
        Row: {
          ativo: boolean
          categoria_id: string | null
          created_at: string
          descricao: string | null
          estoque_minimo: number
          id: string
          nome: string
          sala_id: string | null
          unidade: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          categoria_id?: string | null
          created_at?: string
          descricao?: string | null
          estoque_minimo?: number
          id?: string
          nome: string
          sala_id?: string | null
          unidade?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          categoria_id?: string | null
          created_at?: string
          descricao?: string | null
          estoque_minimo?: number
          id?: string
          nome?: string
          sala_id?: string | null
          unidade?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "produtos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produtos_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          must_change_password: boolean
          nome: string
          sala_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          must_change_password?: boolean
          nome: string
          sala_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          must_change_password?: boolean
          nome?: string
          sala_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
        ]
      }
      salas: {
        Row: {
          created_at: string
          id: string
          nome: string
        }
        Insert: {
          created_at?: string
          id?: string
          nome: string
        }
        Update: {
          created_at?: string
          id?: string
          nome?: string
        }
        Relationships: []
      }
      solicitacao_itens: {
        Row: {
          id: string
          produto_id: string
          quantidade: number
          solicitacao_id: string
        }
        Insert: {
          id?: string
          produto_id: string
          quantidade: number
          solicitacao_id: string
        }
        Update: {
          id?: string
          produto_id?: string
          quantidade?: number
          solicitacao_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "solicitacao_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitacao_itens_solicitacao_id_fkey"
            columns: ["solicitacao_id"]
            isOneToOne: false
            referencedRelation: "solicitacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      solicitacoes: {
        Row: {
          created_at: string
          decidido_em: string | null
          decidido_por: string | null
          estoque_baixado: boolean
          id: string
          observacao: string | null
          retirado_em: string | null
          retirado_por: string | null
          sala_id: string
          status: Database["public"]["Enums"]["solicitacao_status"]
          usuario_id: string | null
        }
        Insert: {
          created_at?: string
          decidido_em?: string | null
          decidido_por?: string | null
          estoque_baixado?: boolean
          id?: string
          observacao?: string | null
          retirado_em?: string | null
          retirado_por?: string | null
          sala_id: string
          status?: Database["public"]["Enums"]["solicitacao_status"]
          usuario_id?: string | null
        }
        Update: {
          created_at?: string
          decidido_em?: string | null
          decidido_por?: string | null
          estoque_baixado?: boolean
          id?: string
          observacao?: string | null
          retirado_em?: string | null
          retirado_por?: string | null
          sala_id?: string
          status?: Database["public"]["Enums"]["solicitacao_status"]
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "solicitacoes_decidido_por_fkey"
            columns: ["decidido_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitacoes_sala_id_fkey"
            columns: ["sala_id"]
            isOneToOne: false
            referencedRelation: "salas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ajustar_estoque: {
        Args: {
          _observacao: string
          _produto: string
          _quantidade: number
          _sala: string
        }
        Returns: number
      }
      arquivar_emprestimo: {
        Args: { _emp: string; _retirado_em?: string; _retirado_por?: string }
        Returns: undefined
      }
      arquivar_solicitacao: {
        Args: { _retirado_em?: string; _retirado_por?: string; _solic: string }
        Returns: undefined
      }
      can_access_conversation: {
        Args: { _conv: string; _user: string }
        Returns: boolean
      }
      criar_emprestimo: {
        Args: { _itens: Json; _observacao: string; _sala_origem: string }
        Returns: string
      }
      criar_solicitacao: {
        Args: { _itens: Json; _observacao: string }
        Returns: string
      }
      decidir_emprestimo: {
        Args: { _aprovar: boolean; _emp: string }
        Returns: undefined
      }
      decidir_solicitacao: {
        Args: { _aprovar: boolean; _solic: string }
        Returns: undefined
      }
      disponibilidade_produtos: {
        Args: { _produto_ids: string[] }
        Returns: {
          nivel: string
          produto_id: string
          sala_id: string
          sala_nome: string
        }[]
      }
      excluir_produto: { Args: { _produto: string }; Returns: Json }
      excluir_sala: { Args: { _force?: boolean; _sala: string }; Returns: Json }
      get_or_create_direct_conversation: {
        Args: { _other: string }
        Returns: string
      }
      get_or_create_master_conversation: {
        Args: { _owner?: string }
        Returns: string
      }
      get_or_create_pedido_conversation: {
        Args: { _id: string; _kind: string }
        Returns: string
      }
      get_or_create_sala_conversation: {
        Args: { _sala: string }
        Returns: string
      }
      get_user_sala: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      list_my_conversations: {
        Args: never
        Returns: {
          id: string
          last_message_at: string
          last_message_body: string
          last_sender_id: string
          owner_user_id: string
          related_emprestimo_id: string
          related_requisicao_id: string
          sala_id: string
          title: string
          type: Database["public"]["Enums"]["conversation_type"]
          unread_count: number
          updated_at: string
        }[]
      }
      marcar_senha_trocada: { Args: never; Returns: undefined }
      mark_conversation_read: { Args: { _conv: string }; Returns: undefined }
      quitar_divida: {
        Args: { _divida: string; _quantidade: number }
        Returns: undefined
      }
      reativar_produto: { Args: { _produto: string }; Returns: undefined }
      registrar_devolucao: {
        Args: { _emp: string; _itens: Json; _observacao?: string }
        Returns: string
      }
      reset_sistema_total: { Args: never; Returns: Json }
      send_message: {
        Args: {
          _attachment_name?: string
          _attachment_path?: string
          _attachment_type?: string
          _body: string
          _conv: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "master" | "admin" | "analista"
      conversation_type: "direct" | "sala" | "master"
      emprestimo_status: "pendente" | "aprovado" | "rejeitado" | "arquivado"
      movimentacao_tipo:
        | "entrada"
        | "saida"
        | "ajuste"
        | "solicitacao"
        | "estorno"
        | "emprestimo_saida"
        | "emprestimo_entrada"
      solicitacao_status: "pendente" | "aprovado" | "rejeitado" | "arquivado"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["master", "admin", "analista"],
      conversation_type: ["direct", "sala", "master"],
      emprestimo_status: ["pendente", "aprovado", "rejeitado", "arquivado"],
      movimentacao_tipo: [
        "entrada",
        "saida",
        "ajuste",
        "solicitacao",
        "estorno",
        "emprestimo_saida",
        "emprestimo_entrada",
      ],
      solicitacao_status: ["pendente", "aprovado", "rejeitado", "arquivado"],
    },
  },
} as const
