import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Brain, Heart, Activity } from 'lucide-react';

export const WellnessDashboard: React.FC = () => {
  return (
    <div className="p-8 bg-white h-full">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Brain className="w-6 h-6 text-gray-700" />
          <h1 className="text-2xl font-semibold text-gray-900">Wellness Dashboard</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="border border-gray-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2 text-gray-900">
                <Heart className="w-5 h-5 text-gray-600" />
                Mood Tracking
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                Track your daily mood and emotional patterns
              </p>
            </CardContent>
          </Card>

          <Card className="border border-gray-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2 text-gray-900">
                <Activity className="w-5 h-5 text-gray-600" />
                Progress
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                Monitor your mental health journey and goals
              </p>
            </CardContent>
          </Card>

          <Card className="border border-gray-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2 text-gray-900">
                <Brain className="w-5 h-5 text-gray-600" />
                Insights
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                AI-powered insights about your wellbeing
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};