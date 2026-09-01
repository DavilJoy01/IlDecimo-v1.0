export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          unique_user_id: string;
          phone: string;
          first_name: string;
          last_name: string;
          birth_date: string;
          height_cm: number;
          preferred_foot: 'left' | 'right' | 'both';
          player_role: 'player' | 'goalkeeper' | 'both';
          profile_image_url: string | null;
          matches_played_count: number;
          matches_completed_count: number;
          matches_abandoned_count: number;
          created_at: string;
          updated_at: string;
        };
      };
      matches: {
        Row: {
          id: string;
          creator_id: string;
          match_type: 5 | 7 | 8;
          field_name: string;
          address: string;
          latitude: number;
          longitude: number;
          match_date: string;
          start_time: string;
          end_time: string;
          max_players: number;
          description: string | null;
          status: 'draft' | 'open' | 'full' | 'started' | 'completed' | 'cancelled';
          created_at: string;
          updated_at: string;
        };
      };
    };
  };
}
