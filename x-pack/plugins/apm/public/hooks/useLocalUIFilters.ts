/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { omit } from 'lodash';
import { useHistory } from 'react-router-dom';
import { Projection } from '../../common/projections';
import { pickKeys } from '../../common/utils/pick_keys';
// eslint-disable-next-line @kbn/eslint/no-restricted-paths
import { LocalUIFiltersAPIResponse } from '../../server/lib/ui_filters/local_ui_filters';
import {
  localUIFilters,
  // eslint-disable-next-line @kbn/eslint/no-restricted-paths
} from '../../server/lib/ui_filters/local_ui_filters/config';
import { fromQuery, toQuery } from '../components/shared/Links/url_helpers';
import { removeUndefinedProps } from '../context/url_params_context/helpers';
import { useFetcher } from './use_fetcher';
import { useUrlParams } from '../context/url_params_context/use_url_params';
import { LocalUIFilterName } from '../../common/ui_filter';

const getInitialData = (
  filterNames: LocalUIFilterName[]
): LocalUIFiltersAPIResponse => {
  return filterNames.map((filterName) => ({
    options: [],
    ...localUIFilters[filterName],
  }));
};

export function useLocalUIFilters({
  projection,
  filterNames,
  params,
  shouldFetch,
}: {
  projection: Projection;
  filterNames: LocalUIFilterName[];
  params?: Record<string, string | number | boolean | undefined>;
  shouldFetch: boolean;
}) {
  const history = useHistory();
  const { uiFilters, urlParams } = useUrlParams();

  const values = pickKeys(uiFilters, ...filterNames);

  const setFilterValue = (name: LocalUIFilterName, value: string[]) => {
    const search = omit(toQuery(history.location.search), name);

    history.push({
      ...history.location,
      search: fromQuery(
        removeUndefinedProps({
          ...search,
          [name]: value.length ? value.join(',') : undefined,
        })
      ),
    });
  };

  const clearValues = () => {
    const search = omit(toQuery(history.location.search), filterNames);
    history.push({
      ...history.location,
      search: fromQuery(search),
    });
  };

  const { data = getInitialData(filterNames), status } = useFetcher(
    (callApmApi) => {
      if (shouldFetch && urlParams.start && urlParams.end) {
        return callApmApi({
          endpoint: `GET /api/apm/ui_filters/local_filters/${projection}` as const,
          params: {
            query: {
              uiFilters: JSON.stringify(uiFilters),
              start: urlParams.start,
              end: urlParams.end,
              // type expects string constants, but we have to send it as json
              filterNames: JSON.stringify(filterNames) as any,
              ...params,
            },
          },
        });
      }
    },
    [
      projection,
      uiFilters,
      urlParams.start,
      urlParams.end,
      filterNames,
      params,
      shouldFetch,
    ]
  );

  const filters = data.map((filter) => ({
    ...filter,
    value: values[filter.name] || [],
  }));

  return {
    filters,
    status,
    setFilterValue,
    clearValues,
  };
}
